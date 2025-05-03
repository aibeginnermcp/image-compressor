/**
 * 图片压缩工具的主要功能实现
 * @author Your Name
 */

// 获取DOM元素
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const qualitySlider = document.getElementById('quality');
const qualityValue = document.getElementById('qualityValue');
const originalPreview = document.getElementById('originalPreview');
const compressedPreview = document.getElementById('compressedPreview');
const originalSize = document.getElementById('originalSize');
const compressedSize = document.getElementById('compressedSize');
const downloadBtn = document.getElementById('downloadBtn');
const batchDownloadBtn = document.getElementById('batchDownloadBtn');
const imageList = document.getElementById('imageList');

// 存储当前处理的所有图片文件
let imageFiles = [];
// 存储压缩后的文件
let compressedFiles = [];
// 当前预览的图片索引
let currentPreviewIndex = 0;
// 存储原始图片的 URL
let originalImageUrls = [];
// 存储压缩后图片的 URL
let compressedImageUrls = [];

// 添加压缩队列管理
const compressionQueue = {
    maxConcurrent: 5, // 增加最大并发数
    running: 0,
    queue: [],
    
    /**
     * 添加压缩任务到队列
     * @param {Function} task - 压缩任务
     */
    async add(task) {
        this.queue.push(task);
        await this.processQueue();
    },
    
    /**
     * 处理队列中的任务
     */
    async processQueue() {
        if (this.running >= this.maxConcurrent || this.queue.length === 0) return;
        
        // 同时处理多个任务
        const tasksToProcess = Math.min(
            this.maxConcurrent - this.running,
            this.queue.length
        );
        
        const tasks = [];
        for (let i = 0; i < tasksToProcess; i++) {
            this.running++;
            const task = this.queue.shift();
            tasks.push(
                task().finally(() => {
                    this.running--;
                    this.processQueue();
                })
            );
        }
        
        // 并行执行任务
        await Promise.all(tasks);
    }
};

/**
 * 格式化文件大小
 * @param {number} bytes - 文件大小（字节）
 * @returns {string} 格式化后的文件大小
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 清理 URL 对象
 * @param {string} url - 要清理的 URL
 */
function revokeURL(url) {
    if (url && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}

/**
 * 检查文件格式是否支持
 * @param {File} file - 要检查的文件
 * @returns {boolean} 是否支持
 */
function isFormatSupported(file) {
    const supportedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    return supportedFormats.includes(file.type);
}

/**
 * 获取优化的压缩选项
 * @param {File} file - 原始图片文件
 * @param {number} quality - 压缩质量（0-100）
 * @returns {Object} 压缩选项
 */
function getOptimizedCompressionOptions(file, quality) {
    const qualityFactor = quality / 100;
    const fileSize = file.size / (1024 * 1024); // 转换为MB
    const fileSizeKB = file.size / 1024; // 转换为KB
    
    // 基础压缩策略
    let targetQuality = qualityFactor;
    let maxWidthOrHeight = 4096;
    let alwaysKeepResolution = false;
    
    // 根据文件大小优化压缩参数
    if (fileSize > 2) { // > 2MB
        targetQuality = Math.min(qualityFactor, 0.65);
        maxWidthOrHeight = 1920;
        alwaysKeepResolution = false;
    } else if (fileSize > 1) { // 1MB - 2MB
        targetQuality = Math.min(qualityFactor, 0.7);
        maxWidthOrHeight = 2048;
        alwaysKeepResolution = false;
    } else if (fileSize > 0.5) { // 500KB - 1MB
        targetQuality = Math.min(qualityFactor, 0.75);
        maxWidthOrHeight = 2560;
        alwaysKeepResolution = false;
    } else if (fileSize > 0.2) { // 200KB - 500KB
        targetQuality = Math.min(qualityFactor, 0.8);
        maxWidthOrHeight = 3072;
        alwaysKeepResolution = false;
    } else if (fileSize > 0.15) { // 150KB - 200KB
        targetQuality = Math.min(qualityFactor, 0.82);
        maxWidthOrHeight = 3072;
        alwaysKeepResolution = true;
    } else if (fileSize > 0.1) { // 100KB - 150KB
        targetQuality = Math.min(qualityFactor, 0.85);
        maxWidthOrHeight = 4096;
        alwaysKeepResolution = true;
    } else if (fileSize > 0.05) { // 50KB - 100KB
        targetQuality = Math.min(Math.max(qualityFactor, 0.88), 0.95);
        maxWidthOrHeight = 4096;
        alwaysKeepResolution = true;
    }
    
    // 根据图片类型调整质量
    if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
        // JPEG格式可以使用更低的质量而不明显损失视觉效果
        targetQuality = Math.min(targetQuality, 0.92);
        // 对于较大的JPEG文件，可以更激进地压缩
        if (fileSizeKB > 150) {
            targetQuality = Math.min(targetQuality, 0.85);
        }
    } else if (file.type === 'image/png') {
        // PNG格式需要更高的质量以保持清晰度
        if (fileSizeKB > 150) {
            targetQuality = Math.min(Math.max(targetQuality, 0.75), 0.92);
        } else {
            targetQuality = Math.min(Math.max(targetQuality, 0.8), 0.95);
        }
    }
    
    // 根据用户设置的质量值进一步调整
    if (quality < 90) {
        targetQuality = Math.min(targetQuality, quality / 100);
    }
    
    // 确保最小压缩比（根据文件大小动态调整）
    let minCompressionRatio;
    if (fileSizeKB > 200) {
        minCompressionRatio = 0.8; // 大文件压缩到80%
    } else if (fileSizeKB > 150) {
        minCompressionRatio = 0.85; // 中等文件压缩到85%
    } else if (fileSizeKB > 100) {
        minCompressionRatio = 0.88; // 较小文件压缩到88%
    } else {
        minCompressionRatio = 0.9; // 小文件最多压缩到90%
    }
    
    const maxSizeMB = Math.min(fileSize * minCompressionRatio, fileSize * targetQuality);
    
    console.log(`压缩策略: 文件大小=${fileSize.toFixed(2)}MB (${fileSizeKB.toFixed(1)}KB), 目标质量=${(targetQuality*100).toFixed(1)}%, 最大输出=${maxSizeMB.toFixed(2)}MB, 最小压缩比=${(minCompressionRatio*100).toFixed(1)}%`);
    
    return {
        maxSizeMB: maxSizeMB,
        maxWidthOrHeight: maxWidthOrHeight,
        useWebWorker: true,
        quality: targetQuality,
        alwaysKeepResolution: alwaysKeepResolution,
        initialQuality: targetQuality,
        fileType: file.type,
        preserveExif: fileSize < 0.1, // 只在小文件保留EXIF信息
        strict: true // 严格遵守maxSizeMB限制
    };
}

/**
 * 更新压缩进度显示
 * @param {number} progress - 压缩进度（0-100）
 */
function updateCompressionProgress(progress) {
    const progressContainer = document.querySelector('.compression-progress-container');
    const progressBar = document.getElementById('compressionProgress');
    
    if (progress === 0 || progress === 100) {
        progressContainer.classList.remove('active');
    } else {
        progressContainer.classList.add('active');
    }
    
    progressBar.style.width = `${progress}%`;
}

/**
 * 压缩图片
 * @param {File} file - 原始图片文件
 * @param {number} quality - 压缩质量（0-100）
 * @returns {Promise<File>} 压缩后的图片文件
 */
async function compressImage(file, quality) {
    if (!isFormatSupported(file)) {
        throw new Error('不支持的文件格式');
    }

    try {
        updateCompressionProgress(10);
        
        // 如果质量为100%且文件小于50KB，返回原文件
        if (quality >= 100 && file.size < 51200) {
            console.log('质量设置为100%且文件较小，使用原文件');
            return file;
        }
        
        // 对于小文件采用保守压缩策略
        if (file.size < 51200) { // 小于50KB
            const smallFileOptions = {
                maxSizeMB: file.size / (1024 * 1024), // 不超过原始大小
                maxWidthOrHeight: 4096,
                useWebWorker: true,
                quality: 0.95,
                alwaysKeepResolution: true,
                preserveExif: true
            };
            
            const compressedSmallFile = await imageCompression(file, smallFileOptions);
            if (compressedSmallFile.size >= file.size * 0.95) {
                return file;
            }
            return compressedSmallFile;
        }
        
        // 获取压缩选项
        const options = getOptimizedCompressionOptions(file, quality);
        
        updateCompressionProgress(30);
        let compressedFile = await imageCompression(file, options);
        updateCompressionProgress(70);
        
        // 如果压缩效果不理想，尝试更激进的压缩
        if (compressedFile.size > file.size * 0.92) { // 如果压缩率小于8%
            console.log('首次压缩效果不理想，尝试更激进的压缩...');
            
            // 计算更激进的压缩参数
            const aggressiveQuality = Math.min(options.quality * 0.85, 0.6);
            const aggressiveMaxSize = Math.min(options.maxWidthOrHeight * 0.9, 2048);
            
            const aggressiveOptions = {
                ...options,
                quality: aggressiveQuality,
                maxWidthOrHeight: aggressiveMaxSize,
                alwaysKeepResolution: false,
                preserveExif: false,
                strict: true
            };
            
            console.log(`尝试激进压缩: 质量=${(aggressiveQuality*100).toFixed(1)}%, 最大尺寸=${aggressiveMaxSize}`);
            
            const aggressiveResult = await imageCompression(file, aggressiveOptions);
            
            // 如果激进压缩效果更好且质量可接受，使用激进压缩结果
            if (aggressiveResult.size < compressedFile.size * 0.95) {
                console.log('使用激进压缩结果');
                compressedFile = aggressiveResult;
            }
        }
        
        // 如果压缩后仍然更大，返回原文件
        if (compressedFile.size >= file.size) {
            console.log('压缩后文件更大，使用原文件');
            return file;
        }
        
        // 计算压缩率和质量损失
        const compressionRatio = (file.size - compressedFile.size) / file.size * 100;
        console.log(`压缩完成: 原始大小=${formatFileSize(file.size)}, 压缩后=${formatFileSize(compressedFile.size)}, 压缩率=${compressionRatio.toFixed(1)}%`);
        
        updateCompressionProgress(100);
        setTimeout(() => updateCompressionProgress(0), 300);
        
        return compressedFile;
    } catch (error) {
        console.error('压缩过程出错:', error);
        return file; // 出错时返回原文件
    }
}

/**
 * 获取压缩结果信息
 * @param {File} originalFile - 原始文件
 * @param {File} compressedFile - 压缩后的文件
 * @returns {Object} 压缩结果信息
 */
function getCompressionResult(originalFile, compressedFile) {
    const originalSize = originalFile.size;
    const compressedSize = compressedFile.size;
    
    if (compressedSize >= originalSize) {
        return {
            status: 'unchanged',
            message: `${formatFileSize(originalSize)} (已使用原图，无需压缩)`
        };
    } else {
        const compressionRatio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
        return {
            status: 'compressed',
            message: `${formatFileSize(compressedSize)} (节省 ${compressionRatio}%)`
        };
    }
}

/**
 * 更新图片列表项状态
 * @param {number} index - 图片索引
 * @param {string} status - 状态（'processing'|'success'|'error'）
 * @param {Object} compressionResult - 压缩结果信息
 */
function updateImageListItemStatus(index, status, compressionResult = null) {
    const listItem = document.querySelector(`[data-index="${index}"]`);
    if (!listItem) return;
    
    // 移除所有状态类
    listItem.classList.remove('processing', 'success', 'error');
    
    // 添加新状态类
    listItem.classList.add(status);
    
    // 更新状态文本
    const statusElement = listItem.querySelector('.status');
    if (statusElement) {
        switch (status) {
            case 'processing':
                statusElement.textContent = '处理中...';
                break;
            case 'success':
                statusElement.textContent = compressionResult ? 
                    (compressionResult.status === 'compressed' ? '压缩完成' : '无需压缩') :
                    '处理完成';
                break;
            case 'error':
                statusElement.textContent = '处理失败';
                break;
        }
    }
    
    // 如果有压缩结果，更新文件大小显示
    if (compressionResult) {
        const sizeElement = listItem.querySelector('.compression-info');
        if (sizeElement) {
            sizeElement.textContent = compressionResult.message;
        }
    }
}

/**
 * 更新图片列表显示
 */
function updateImageList() {
    const container = document.querySelector('.image-list');
    if (!container) return;
    
    container.innerHTML = imageFiles.map((file, index) => `
        <div class="image-list-item processing" data-index="${index}">
            <div class="image-info">
                <div class="filename">${file.name}</div>
                <div class="filesize">${formatFileSize(file.size)}</div>
                <div class="compression-info"></div>
            </div>
            <div class="status">处理中...</div>
        </div>
    `).join('');
    
    // 添加点击事件
    container.querySelectorAll('.image-list-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            if (!isNaN(index)) {
                previewImage(index);
            }
        });
    });
}

/**
 * 预览指定索引的图片
 * @param {number} index - 图片索引
 */
async function previewImage(index) {
    if (index < 0 || index >= imageFiles.length) return;
    
    currentPreviewIndex = index;
    const file = imageFiles[index];
    
    // 更新列表选中状态
    document.querySelectorAll('.image-list-item').forEach((item, i) => {
        item.classList.toggle('active', i === index);
    });
    
    // 清理之前的 URL
    revokeURL(originalPreview.src);
    revokeURL(compressedPreview.src);
    
    // 显示原图预览
    originalImageUrls[index] = originalImageUrls[index] || URL.createObjectURL(file);
    originalPreview.src = originalImageUrls[index];
    originalSize.textContent = formatFileSize(file.size);
    
    // 如果已经有压缩结果，直接显示
    if (compressedFiles[index]) {
        await updatePreview(index);
    } else {
        // 否则显示处理中状态
        compressedPreview.style.opacity = '0.5';
        compressedSize.textContent = '压缩中...';
        updateImageListItemStatus(index, 'processing');
    }
}

/**
 * 压缩当前预览的图片
 */
async function compressCurrentImage() {
    const file = imageFiles[currentPreviewIndex];
    if (!file) return;

    try {
        // 显示加载状态
        compressedPreview.style.opacity = '0.5';
        compressedSize.textContent = '压缩中...';
        
        const quality = parseInt(qualitySlider.value);
        const compressedFile = await compressImage(file, quality);
        
        // 更新压缩后的文件
        compressedFiles[currentPreviewIndex] = compressedFile;
        
        // 清理之前的 URL
        revokeURL(compressedImageUrls[currentPreviewIndex]);
        
        // 显示压缩后的预览
        compressedImageUrls[currentPreviewIndex] = URL.createObjectURL(compressedFile);
        compressedPreview.src = compressedImageUrls[currentPreviewIndex];
        compressedPreview.style.opacity = '1';
        
        // 获取压缩结果
        const compressionResult = getCompressionResult(file, compressedFile);
        
        // 更新压缩信息显示
        compressedSize.textContent = compressionResult.message;
        
        // 更新列表项状态
        updateImageListItemStatus(currentPreviewIndex, 'success', compressionResult);
        
        // 启用下载按钮
        downloadBtn.disabled = false;
        batchDownloadBtn.disabled = imageFiles.length === 0;
    } catch (error) {
        console.error('压缩处理出错:', error);
        compressedPreview.style.opacity = '1';
        compressedSize.textContent = '压缩失败，请重试';
        
        // 如果压缩失败，显示原图
        compressedPreview.src = originalPreview.src;
    }
}

/**
 * 更新预览显示
 * @param {number} index - 图片索引
 */
async function updatePreview(index) {
    const file = imageFiles[index];
    const compressedFile = compressedFiles[index];
    
    if (!file || !compressedFile) {
        compressedPreview.style.opacity = '0.5';
        compressedSize.textContent = '压缩中...';
        updateImageListItemStatus(index, 'processing');
        return;
    }
    
    // 清理之前的 URL
    revokeURL(compressedImageUrls[index]);
    
    // 获取压缩结果
    const compressionResult = getCompressionResult(file, compressedFile);
    
    // 显示压缩后的预览
    if (compressionResult.status === 'unchanged') {
        compressedPreview.src = originalImageUrls[index];
    } else {
        compressedImageUrls[index] = URL.createObjectURL(compressedFile);
        compressedPreview.src = compressedImageUrls[index];
    }
    compressedPreview.style.opacity = '1';
    
    // 更新压缩信息显示
    compressedSize.textContent = compressionResult.message;
    
    // 更新列表项状态
    updateImageListItemStatus(index, 'success', compressionResult);
    
    // 启用下载按钮
    downloadBtn.disabled = false;
    batchDownloadBtn.disabled = imageFiles.length === 0;
}

/**
 * 处理新添加的图片文件
 * @param {FileList} files - 图片文件列表
 */
async function handleImageFiles(files) {
    const imageFilesArray = Array.from(files).filter(isFormatSupported);
    if (imageFilesArray.length === 0) {
        alert('请上传支持的图片格式（JPG、PNG、WebP、GIF）');
        return;
    }

    // 限制最大处理数量
    if (imageFiles.length + imageFilesArray.length > 10) {
        alert('为保证处理质量，一次最多处理10张图片');
        return;
    }

    // 添加新文件到数组
    const startIndex = imageFiles.length;
    imageFiles.push(...imageFilesArray);
    compressedFiles = new Array(imageFiles.length);
    originalImageUrls = new Array(imageFiles.length);
    compressedImageUrls = new Array(imageFiles.length);
    
    // 更新图片列表
    updateImageList();
    
    // 预览第一张新添加的图片
    await previewImage(startIndex);
    
    // 并发处理所有图片
    const quality = parseInt(qualitySlider.value);
    const compressionTasks = imageFilesArray.map((file, i) => {
        const index = startIndex + i;
        return async () => {
            try {
                // 更新状态为处理中
                if (index !== currentPreviewIndex) {
                    updateImageListItemStatus(index, 'processing');
                }
                
                // 压缩图片
                const compressedFile = await compressImage(file, quality);
                compressedFiles[index] = compressedFile;
                
                // 如果是当前预览的图片，更新预览
                if (index === currentPreviewIndex) {
                    await updatePreview(index);
                } else {
                    // 否则只更新列表状态
                    const compressionResult = getCompressionResult(file, compressedFile);
                    updateImageListItemStatus(index, 'success', compressionResult);
                }
            } catch (error) {
                console.error(`处理第 ${index + 1} 张图片时出错:`, error);
                updateImageListItemStatus(index, 'error');
                if (index === currentPreviewIndex) {
                    compressedPreview.style.opacity = '1';
                    compressedSize.textContent = '压缩失败';
                }
            }
        };
    });

    // 批量添加任务到队列
    await Promise.all(compressionTasks.map(task => compressionQueue.add(task)));
}

/**
 * 批量下载压缩后的图片
 */
async function downloadAll() {
    try {
        // 创建ZIP文件
        const zip = new JSZip();
        
        // 添加所有压缩后的图片到ZIP
        for (let i = 0; i < imageFiles.length; i++) {
            const originalFile = imageFiles[i];
            let compressedFile = compressedFiles[i];
            
            // 如果还没有压缩，先进行压缩
            if (!compressedFile) {
                compressedFile = await compressImage(originalFile, parseInt(qualitySlider.value));
            }
            
            // 如果压缩后文件更大，使用原文件
            const fileToAdd = compressedFile.size >= originalFile.size ? originalFile : compressedFile;
            zip.file(fileToAdd === originalFile ? originalFile.name : `compressed_${originalFile.name}`, fileToAdd);
        }
        
        // 生成并下载ZIP文件
        const content = await zip.generateAsync({type: 'blob'});
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'compressed_images.zip';
        link.click();
        
        // 清理URL
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch (error) {
        alert('批量下载时出错: ' + error.message);
    }
}

// 监听文件拖放
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--primary-color)';
    dropZone.style.background = '#F5F5F7';
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#C7C7CC';
    dropZone.style.background = 'var(--card-background)';
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#C7C7CC';
    dropZone.style.background = 'var(--card-background)';
    handleImageFiles(e.dataTransfer.files);
});

// 监听文件选择
dropZone.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleImageFiles(e.target.files);
    }
});

// 使用防抖优化滑块变化事件
let debounceTimer;
qualitySlider.addEventListener('input', (e) => {
    const quality = e.target.value;
    qualityValue.textContent = quality + '%';
    
    // 清除之前的定时器
    clearTimeout(debounceTimer);
    
    // 显示正在处理的状态
    compressedPreview.style.opacity = '0.5';
    compressedSize.textContent = '压缩中...';
    
    // 设置新的定时器
    debounceTimer = setTimeout(() => {
        compressCurrentImage().catch(error => {
            console.error('压缩过程出错:', error);
            compressedPreview.style.opacity = '1';
            compressedSize.textContent = '压缩失败，请重试';
            // 如果压缩失败，显示原图
            compressedPreview.src = originalPreview.src;
        });
    }, 300);
});

// 单个图片下载按钮点击事件
downloadBtn.onclick = () => {
    const file = imageFiles[currentPreviewIndex];
    const compressedFile = compressedFiles[currentPreviewIndex];
    if (file && compressedFile) {
        // 如果压缩后文件更大，下载原文件
        const fileToDownload = compressedFile.size >= file.size ? file : compressedFile;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(fileToDownload);
        link.download = fileToDownload === file ? file.name : `compressed_${file.name}`;
        link.click();
        
        // 清理URL
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
};

// 批量下载按钮点击事件
batchDownloadBtn.onclick = downloadAll;

// 页面卸载时清理所有 URL
window.addEventListener('beforeunload', () => {
    originalImageUrls.forEach(revokeURL);
    compressedImageUrls.forEach(revokeURL);
});

/**
 * 初始化快捷键
 */
function initShortcuts() {
    document.addEventListener('keydown', (e) => {
        // 如果在输入框中，不触发快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        // Ctrl/Cmd + O: 打开文件
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            fileInput.click();
        }
        
        // Ctrl/Cmd + S: 下载当前图片
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            if (!downloadBtn.disabled) {
                downloadBtn.click();
            }
        }
        
        // Ctrl/Cmd + Shift + S: 批量下载
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            if (!batchDownloadBtn.disabled) {
                batchDownloadBtn.click();
            }
        }
        
        // 左右方向键：切换图片
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const direction = e.key === 'ArrowLeft' ? -1 : 1;
            const newIndex = currentPreviewIndex + direction;
            if (newIndex >= 0 && newIndex < imageFiles.length) {
                previewImage(newIndex);
            }
        }
        
        // Delete/Backspace: 从列表中移除当前图片
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            if (imageFiles.length > 0) {
                imageFiles.splice(currentPreviewIndex, 1);
                compressedFiles.splice(currentPreviewIndex, 1);
                originalImageUrls.splice(currentPreviewIndex, 1);
                compressedImageUrls.splice(currentPreviewIndex, 1);
                
                if (currentPreviewIndex >= imageFiles.length) {
                    currentPreviewIndex = Math.max(0, imageFiles.length - 1);
                }
                
                updateImageList();
                if (imageFiles.length > 0) {
                    previewImage(currentPreviewIndex);
                } else {
                    // 清空预览
                    originalPreview.src = '';
                    compressedPreview.src = '';
                    originalSize.textContent = '-';
                    compressedSize.textContent = '-';
                    downloadBtn.disabled = true;
                    batchDownloadBtn.disabled = true;
                }
            }
        }
    });
}

// 初始化快捷键
initShortcuts();

/**
 * 图片编辑功能
 */
class ImageEditor {
    constructor() {
        this.canvas = document.getElementById('editCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.dialog = document.getElementById('editDialog');
        this.currentImage = null;
        this.editMode = null;
        this.isEditing = false;
        
        // 绑定按钮事件
        document.getElementById('cropBtn').onclick = () => this.startEdit('crop');
        document.getElementById('rotateBtn').onclick = () => this.startEdit('rotate');
        document.getElementById('flipBtn').onclick = () => this.startEdit('flip');
        document.getElementById('resizeBtn').onclick = () => this.startEdit('resize');
        document.getElementById('closeEditDialog').onclick = () => this.closeEditor();
        document.getElementById('cancelEdit').onclick = () => this.closeEditor();
        document.getElementById('applyEdit').onclick = () => this.applyEdit();
        
        // 初始化编辑状态
        this.cropData = null;
        this.rotateAngle = 0;
        this.flipX = false;
        this.flipY = false;
        
        // 绑定键盘事件
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isEditing) {
                this.closeEditor();
            }
        });
        
        // 绑定鼠标事件
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('wheel', this.handleWheel.bind(this));
    }
    
    /**
     * 开始编辑
     * @param {string} mode - 编辑模式
     */
    async startEdit(mode) {
        if (!imageFiles[currentPreviewIndex]) return;
        
        this.editMode = mode;
        this.isEditing = true;
        this.dialog.classList.add('active');
        
        // 加载图片
        const img = new Image();
        img.src = originalImageUrls[currentPreviewIndex];
        await new Promise(resolve => img.onload = resolve);
        
        // 设置画布大小
        const maxWidth = 800;
        const maxHeight = 600;
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
        }
        if (height > maxHeight) {
            width = (maxHeight / height) * width;
            height = maxHeight;
        }
        
        this.canvas.width = width;
        this.canvas.height = height;
        this.currentImage = img;
        
        // 重置编辑状态
        this.cropData = null;
        this.rotateAngle = 0;
        this.flipX = false;
        this.flipY = false;
        
        // 初始化编辑模式
        switch (mode) {
            case 'crop':
                this.initCrop();
                break;
            case 'rotate':
                // 添加旋转控制UI
                this.addRotateControls();
                break;
            case 'flip':
                // 添加翻转控制UI
                this.addFlipControls();
                break;
            case 'resize':
                // 添加缩放控制UI
                this.addResizeControls();
                break;
        }
        
        this.drawImage();
    }
    
    /**
     * 处理鼠标按下事件
     */
    handleMouseDown(e) {
        if (!this.isEditing) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        switch (this.editMode) {
            case 'crop':
                this.handleCropMouseDown(x, y);
                break;
            case 'rotate':
                this.handleRotateMouseDown(x, y);
                break;
        }
    }
    
    /**
     * 处理鼠标移动事件
     */
    handleMouseMove(e) {
        if (!this.isEditing) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        switch (this.editMode) {
            case 'crop':
                this.handleCropMouseMove(x, y);
                break;
            case 'rotate':
                this.handleRotateMouseMove(x, y);
                break;
        }
    }
    
    /**
     * 处理鼠标抬起事件
     */
    handleMouseUp() {
        if (!this.isEditing) return;
        
        switch (this.editMode) {
            case 'crop':
                this.handleCropMouseUp();
                break;
            case 'rotate':
                this.handleRotateMouseUp();
                break;
        }
    }
    
    /**
     * 处理鼠标滚轮事件
     */
    handleWheel(e) {
        if (!this.isEditing || this.editMode !== 'rotate') return;
        
        e.preventDefault();
        const delta = e.deltaY > 0 ? -5 : 5;
        this.rotateAngle = (this.rotateAngle + delta) % 360;
        this.drawImage();
    }
    
    /**
     * 添加旋转控制UI
     */
    addRotateControls() {
        const controls = document.createElement('div');
        controls.className = 'rotate-controls';
        controls.innerHTML = `
            <button class="rotate-btn" data-angle="-90">向左旋转90°</button>
            <button class="rotate-btn" data-angle="90">向右旋转90°</button>
            <div class="rotate-slider">
                <input type="range" min="0" max="360" value="0" step="1">
                <span class="angle-value">0°</span>
            </div>
        `;
        
        this.dialog.querySelector('.edit-dialog-body').appendChild(controls);
        
        // 绑定控制事件
        controls.querySelectorAll('.rotate-btn').forEach(btn => {
            btn.onclick = () => {
                const angle = parseInt(btn.dataset.angle);
                this.rotateAngle = (this.rotateAngle + angle) % 360;
                this.drawImage();
            };
        });
        
        const slider = controls.querySelector('input[type="range"]');
        const angleValue = controls.querySelector('.angle-value');
        slider.oninput = (e) => {
            this.rotateAngle = parseInt(e.target.value);
            angleValue.textContent = `${this.rotateAngle}°`;
            this.drawImage();
        };
    }
    
    /**
     * 添加翻转控制UI
     */
    addFlipControls() {
        const controls = document.createElement('div');
        controls.className = 'flip-controls';
        controls.innerHTML = `
            <button class="flip-btn" data-axis="x">水平翻转</button>
            <button class="flip-btn" data-axis="y">垂直翻转</button>
        `;
        
        this.dialog.querySelector('.edit-dialog-body').appendChild(controls);
        
        // 绑定控制事件
        controls.querySelectorAll('.flip-btn').forEach(btn => {
            btn.onclick = () => {
                const axis = btn.dataset.axis;
                if (axis === 'x') {
                    this.flipX = !this.flipX;
                } else {
                    this.flipY = !this.flipY;
                }
                this.drawImage();
            };
        });
    }
    
    /**
     * 添加缩放控制UI
     */
    addResizeControls() {
        const controls = document.createElement('div');
        controls.className = 'resize-controls';
        controls.innerHTML = `
            <div class="resize-input">
                <label>宽度:</label>
                <input type="number" class="width-input" value="${this.canvas.width}">
            </div>
            <div class="resize-input">
                <label>高度:</label>
                <input type="number" class="height-input" value="${this.canvas.height}">
            </div>
            <label class="maintain-ratio">
                <input type="checkbox" checked>
                保持宽高比
            </label>
        `;
        
        this.dialog.querySelector('.edit-dialog-body').appendChild(controls);
        
        // 绑定控制事件
        const widthInput = controls.querySelector('.width-input');
        const heightInput = controls.querySelector('.height-input');
        const ratioCheckbox = controls.querySelector('input[type="checkbox"]');
        const aspectRatio = this.canvas.width / this.canvas.height;
        
        widthInput.oninput = (e) => {
            const width = parseInt(e.target.value);
            if (ratioCheckbox.checked) {
                const height = Math.round(width / aspectRatio);
                heightInput.value = height;
            }
        };
        
        heightInput.oninput = (e) => {
            const height = parseInt(e.target.value);
            if (ratioCheckbox.checked) {
                const width = Math.round(height * aspectRatio);
                widthInput.value = width;
            }
        };
    }
    
    /**
     * 应用编辑
     */
    async applyEdit() {
        let editedImageData;
        
        switch (this.editMode) {
            case 'crop':
                editedImageData = this.applyCrop();
                break;
            case 'rotate':
                editedImageData = this.canvas.toDataURL();
                break;
            case 'flip':
                editedImageData = this.canvas.toDataURL();
                break;
            case 'resize':
                editedImageData = this.applyResize();
                break;
        }
        
        // 将编辑后的图片转换为File对象
        const response = await fetch(editedImageData);
        const blob = await response.blob();
        const file = new File([blob], imageFiles[currentPreviewIndex].name, {
            type: imageFiles[currentPreviewIndex].type
        });
        
        // 更新图片
        imageFiles[currentPreviewIndex] = file;
        originalImageUrls[currentPreviewIndex] = editedImageData;
        originalPreview.src = editedImageData;
        
        // 重新压缩
        await compressCurrentImage();
        
        // 关闭编辑器
        this.closeEditor();
    }
    
    /**
     * 应用裁剪
     */
    applyCrop() {
        const { x, y, width, height } = this.cropData;
        
        // 创建临时画布
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        
        // 复制裁剪区域
        tempCtx.drawImage(
            this.canvas,
            x, y, width, height,
            0, 0, width, height
        );
        
        return tempCanvas.toDataURL();
    }
    
    /**
     * 应用缩放
     */
    applyResize() {
        const width = parseInt(this.dialog.querySelector('.width-input').value);
        const height = parseInt(this.dialog.querySelector('.height-input').value);
        const ratioCheckbox = this.dialog.querySelector('input[type="checkbox"]');
        const aspectRatio = this.canvas.width / this.canvas.height;
        
        let newWidth = width;
        let newHeight = height;
        
        if (ratioCheckbox.checked) {
            newWidth = Math.round(width / aspectRatio);
            newHeight = Math.round(height / aspectRatio);
        }
        
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        
        this.drawImage();
        
        return this.canvas.toDataURL();
    }
    
    /**
     * 关闭编辑器
     */
    closeEditor() {
        this.dialog.classList.remove('active');
        this.isEditing = false;
        this.editMode = null;
        
        // 移除控制UI
        const controls = this.dialog.querySelector('.edit-dialog-body > div:not(#editCanvas)');
        if (controls) {
            controls.remove();
        }
        
        // 重置状态
        this.cropData = null;
        this.rotateAngle = 0;
        this.flipX = false;
        this.flipY = false;
    }
}

// 初始化图片编辑器
const imageEditor = new ImageEditor(); 