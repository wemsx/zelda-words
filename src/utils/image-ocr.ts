import * as tf from '@tensorflow/tfjs';
import words from '../data/words.json';

function toGray(data: ImageData) {
    const calculateGray = (r: number, g: number, b: number) =>
        Math.floor(r * 0.299 + g * 0.587 + b * 0.114);
    const res = [];
    for (let x = 0; x < data.width; x++) {
        for (let y = 0; y < data.height; y++) {
            const idx = (x + y * data.width) * 4;
            const r = data.data[idx + 0];
            const g = data.data[idx + 1];
            const b = data.data[idx + 2];
            const gray = calculateGray(r, g, b);
            res.push(gray);
        }
    }
    return res;
}

function otsu(imgData: ImageData) {
    const grayData = toGray(imgData);
    let ptr = 0;
    let histData = Array(256).fill(0);
    let total = grayData.length;

    while (ptr < total) {
        let h = 0xff & grayData[ptr++];
        histData[h]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
        sum += i * histData[i];
    }

    let wB = 0;
    let wF = 0;
    let sumB = 0;
    let varMax = 0;
    let threshold = 0;

    for (let t = 0; t < 256; t++) {
        wB += histData[t];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;

        sumB += t * histData[t];

        let mB = sumB / wB;
        let mF = (sum - sumB) / wF;

        let varBetween = wB * wF * (mB - mF) ** 2;

        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }

    return threshold;
}

// 统一转成黑底白色的图片
function unitizeImageData(imageData: ImageData) {
    const { width, height, data } = imageData;
    const threshold = otsu(imageData);
    const head = (data[0] + data[1] + data[2]) / 3 | 0;
    const colors = head > threshold ? [0, 255] : [255, 0];
    const output = new ImageData(width, height);
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const index = (j * width + i) * 4;
            const avg = (data[index] + data[index + 1] + data[index + 2]) / 3 | 0;
            const v = avg > threshold ? colors[0] : colors[1];
            output.data[index] = v;
            output.data[index + 1] = v;
            output.data[index + 2] = v;
            output.data[index + 3] = 255;
        }
    }
    return output;
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = url;
    });
}

function createCavans(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function countPixel(imageData: ImageData, isRow: boolean = false) {
    const { width, height, data } = imageData;
    const offsets = [0, 1, 2];
    const head = offsets.map((i) => data[i]);
    const pixel = [];
    if (isRow) {
        for (let i = 0; i < height; i++) {
            let count = 0;
            for (let j = 0; j < width; j++) {
                const index = (i * width + j) * 4;
                const isEqual = offsets.every(
                    (offset) => head[offset] === data[index + offset]
                );
                count += isEqual ? 0 : 1;
            }
            pixel.push(count);
        }
    } else {
        for (let i = 0; i < width; i++) {
            let count = 0;
            for (let j = 0; j < height; j++) {
                const index = (j * width + i) * 4;
                const isEqual = offsets.every(
                    (offset) => head[offset] === data[index + offset]
                );
                count += isEqual ? 0 : 1;
            }
            pixel.push(count);
        }
    }
    return pixel;
}

type Rang = {
    foreground?: boolean;
    background?: boolean;
    value: number;
};

function countRanges(counts: Array<number>): Array<Rang> {
    const groups = [];
    let foreground = 0;
    let background = 0;
    counts.forEach((count) => {
        if (count) {
            foreground += 1;
            if (background) {
                groups.push({ background: true, value: background });
                background = 0;
            }
        } else {
            background += 1;
            if (foreground) {
                groups.push({ foreground: true, value: foreground });
                foreground = 0;
            }
        }
    });
    if (foreground) {
        groups.push({ foreground: true, value: foreground });
    }
    if (background) {
        groups.push({ background: true, value: background });
    }
    return groups;
}

function getMaxRange(data: Array<Rang>) {
    return data.reduce((max, it) => {
        if (it.foreground) {
            return Math.max(max, it.value);
        }
        return max;
    }, 0);
}

function mergeRanges(data: Array<Rang>, size: number): Array<Rang> {
    const merge: any[] = [];
    let chunks: any[] = [];
    data.forEach((item) => {
        if (chunks.length) {
            chunks.push(item);
            const value = chunks.reduce((sum, chunk) => sum + chunk.value, 0);
            if (value >= size || Math.pow(value - size, 2) < 4) {
                merge.push({
                    foreground: true,
                    value,
                });
                chunks = [];
            }
            return;
        }
        if (item.foreground && item.value < size) {
            chunks = [item];
            return;
        }
        merge.push(item);
    });
    return merge;
}

function createChunks(data: Array<Rang>): Array<any> {
    const chunks: any[] = [];
    let offset = 0;
    data.forEach((item) => {
        if (item.foreground) {
            chunks.push({
                offset,
                size: item.value,
            });
        }
        offset += item.value;
    });
    return chunks;
}

type Chunk = {
    x: number;
    y: number;
    width: number;
    height: number;
    canvas: HTMLCanvasElement;
    data?: Float32Array,
};

function splitImage(image: HTMLImageElement, log: boolean): Array<Chunk> {
    const { naturalWidth: width, naturalHeight: height } = image;
    const canvas = createCavans(width, height);
    const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const imageData = unitizeImageData(ctx.getImageData(0, 0, width, height));
    const unitizeCanvas = createCavans(width, height);
    const unitizeCtx = <CanvasRenderingContext2D>unitizeCanvas.getContext('2d');
    unitizeCtx.putImageData(imageData, 0, 0);

    const rowsPixels = countPixel(imageData, true);
    const colsPixels = countPixel(imageData, false);

    if (log) {
        console.log('rowsPixels:', JSON.stringify(rowsPixels));
        console.log('colsPixels:', JSON.stringify(colsPixels));
    }

    // 逐行扫描
    const rowsRanges = countRanges(rowsPixels);
    // 逐列扫描
    const colsRanges = countRanges(colsPixels);

    // 计算横纵像素分布得出字体内容的大小（字体正方形区域）
    const fontRange = Math.max(
        getMaxRange(rowsRanges),
        getMaxRange(colsRanges)
    );

    const rowsChunks = createChunks(mergeRanges(rowsRanges, fontRange));
    const res: any[] = [];
    rowsChunks.forEach((row) => {
        const rowImageData = unitizeCtx.getImageData(
            0,
            row.offset,
            width,
            row.size
        );
        const rowRanges = countRanges(countPixel(rowImageData, false));
        const rowChunks = createChunks(mergeRanges(rowRanges, fontRange));
        rowChunks.forEach((item) => {
            const itemCanvas = createCavans(item.size, row.size);
            const itemCtx = <CanvasRenderingContext2D>(
                itemCanvas.getContext('2d')
            );
            const itemImageData = unitizeCtx.getImageData(
                item.offset,
                row.offset,
                item.size,
                row.size
            );
            itemCtx.putImageData(itemImageData, 0, 0);
            res.push({
                x: item.offset,
                y: row.offset,
                width: item.size,
                height: item.size,
                canvas: itemCanvas,
            });
        });
    });
    return res;
}

function binaryzationOutput(imageData: ImageData) {
    const { width, height, data } = imageData;
    const threshold = otsu(imageData);
    const head = (data[0] + data[1] + data[2]) / 3 | 0;
    const value = head > threshold ? [0, 1] : [1, 0];
    const hash = new Uint8Array(width * height);
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const index = j * width + i;
            const v = data[index * 4] > threshold ? value[0] : value[1];
            hash.set([v], index);
        }
    }
    return hash;
}

function resizeCanvas(inputCanvas: HTMLCanvasElement, size: number) {
    const outputCavans = createCavans(size, size);
    const outputCtx = <CanvasRenderingContext2D>outputCavans.getContext('2d');
    outputCtx.drawImage(
        inputCanvas,
        0,
        0,
        inputCanvas.width,
        inputCanvas.height,
        0,
        0,
        size,
        size
    );
    return outputCtx.getImageData(0, 0, size, size);
}

async function createImageFingerprints(image: HTMLImageElement, log: boolean) {
    const contents = splitImage(image, log);
    return contents.map(({ canvas, ...args }) => {
        const imageData = resizeCanvas(canvas, 16);
        const hash = binaryzationOutput(imageData);
        return {
            ...args,
            hash,
        };
    });
}

function createSymbols(fingerprints: Array<any>) {
    const WORDS = 'abcdefghijklmnopqrstuvwxyz0123456789.-!?';
    return fingerprints.map((it, index) => {
        return {
            name: WORDS[index],
            value: it.hash,
        };
    });
}

function hammingDistance(hash1: Uint8Array, hash2: Uint8Array) {
    let count = 0;
    hash1.forEach((it, index) => {
        count += it ^ hash2[index];
    });
    return count;
}

function mapSymbols(fingerprints: Array<any>, symbols: Array<any>) {
    return fingerprints.map(({ hash, ...position }) => {
        const isEmpty = hash.every((v: number) => v === hash[0]);
        if (isEmpty) {
            return ' ';
        }
        let diff = Number.MAX_SAFE_INTEGER;
        let word = '*';
        symbols.forEach((symbol) => {
            const distance = hammingDistance(hash, symbol.value);
            // 汉明距离大于标识相似度偏差较大排除
            if (distance < diff) {
                diff = distance;
                word = symbol.name;
            }
        });
        return {
            ...position,
            word,
            diff,
        };
    });
}

function printfSymbols(
    results: Array<any>,
    width: number,
    height: number
): string {
    const canvas = createCavans(width, height);
    const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
    const head = results[0];
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    ctx.font = `${Math.floor(head.width)}px -apple-system, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    results.forEach((item) => {
        ctx.fillText(
            item.word,
            item.x + Math.round(item.width / 2),
            item.y + Math.round(item.height / 2),
            item.width
        );
    });
    return canvas.toDataURL();
}

export async function readMetaInfo(imageUrl: string, mapUrl: string) {
    const mapImage = await loadImage(mapUrl);
    const mapImageFingerprints = await createImageFingerprints(mapImage, false);
    const symbols = createSymbols(mapImageFingerprints);
    const readImage = await loadImage(imageUrl);
    const readImageFingerprints = await createImageFingerprints(
        readImage,
        true,
    );
    const results = mapSymbols(readImageFingerprints, symbols);
    if (results.length) {
        return printfSymbols(
            results,
            readImage.naturalWidth,
            readImage.naturalHeight
        );
    }
    window.alert('无法解析');
    throw new Error('PARSE ERROR');
}


function convertToPredictData(images: Chunk[], imageSize: number) {
    images.forEach(it => {
        const imageData = resizeCanvas(it.canvas, imageSize);
        const pixs = new Float32Array(imageData.data.length / 4);
        let index = 0;
        // rgb 转灰度
        for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            pixs[index] = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            index += 1;
        }
        it.data = pixs;
    });
    const shape: [number, number, number, number] = [images.length, imageSize, imageSize, 1];
    const shapeSize = tf.util.sizeFromShape(shape);
    const concatData = new Float32Array(shapeSize);
    images.forEach((image, index) => {
        concatData.set(image.data as Float32Array, index * imageSize * imageSize);
    });
    return tf.tensor4d(concatData, shape);
}

export async function readMetaInfoByCnn(imageUrl: string) {
    const modelURL = 'https://markdown-write.oss-cn-hangzhou.aliyuncs.com/model.json';
    const imageSize = 28;
    const readImage = await loadImage(imageUrl);
    // 将希卡文的图片拆分出来
    const images = splitImage(readImage, false);
    // 转换成模型需要的张量格式
    const predictData = convertToPredictData(images, imageSize);
    // 加载训练号的模型
    const model = await tf.loadLayersModel(modelURL);
    const output = model.predict(predictData) as tf.Tensor;
    const axis = 1;
    // 获取预测结果的索引
    const predictIndexs = Array.from(output.argMax(axis).dataSync());
    // 通过索引找到目标字符
    const results = predictIndexs.map((predictIndex, index) => {
        const target = words[predictIndex];
        return {
            ...images[index],
            word: target.symbol,
        };

    });
    console.log('results', results);
    if (results.length) {
        return printfSymbols(
            results,
            readImage.naturalWidth,
            readImage.naturalHeight
        );
    }
    window.alert('无法解析');
    throw new Error('PARSE ERROR');
}
