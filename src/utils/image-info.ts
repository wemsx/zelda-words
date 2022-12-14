const BIT_LENGTH = 24;
const MAX_IOS_AREA_SIZE = 16777216 * 0.5;
const MAX_CAVAS_AREA_SIZE = 16000 * 16000 * 0.5;
const IS_IOS = !!window.navigator.userAgent.match(/\(i[^;]+;( U;)? CPU.+Mac OS X/);

function paddingLfet(bits: string) {
    return ('00000000' + bits).slice(-8);
}

function getGcd(a: number, b: number): number {
    let max = Math.max(a, b);
    let min = Math.min(a, b);
    if (max % min === 0) {
        return min;
    } else {
        return getGcd(max % min, min);
    }
}

function getLcm(a: number, b: number) {
    return (a * b) / getGcd(a, b);
}

function colorOffset(hex: string, alpha: number, offset: number) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
        const c = [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
        ].map(v => {
            const nv = v + offset;
            return nv % 255 !== nv ? v - offset : nv;
        }).join(',');
        return `rgba(${c},${alpha})`;
    }
    return '';
}

function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = url;
    });
};

function createCavans(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function putToCanvas(pixels: ImageData) {
    const canvas = document.createElement('canvas');
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
    ctx.putImageData(pixels, 0, 0);
    return canvas;
}

interface Options {
    size: number,
    width: number,
    height: number,
    message?: string,
    vertical: boolean,
    fontColor?: string,
    backgroundColor: string,
}

function createHeadMeta(options: Options) {
    console.log('createHeadMeta', options);
    const verticalBit = paddingLfet(Number(options.vertical).toString(2));
    const sizeBit = paddingLfet(options.size.toString(2));
    const sizeCount = Math.floor(options.width / options.size);
    if (sizeCount > 255) {
        throw new Error('?????????????????????');
    }
    const widthBit = paddingLfet(sizeCount.toString(2));
    const bits = verticalBit + sizeBit + widthBit;
    // ?????????????????? 24 ??????????????????
    const canvasWidth = getLcm(options.width, BIT_LENGTH);
    const canvasHeight = Math.floor(canvasWidth / options.width * options.size);
    const canvas = createCavans(canvasWidth, canvasHeight);
    const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
    const chunkWidth = canvasWidth / BIT_LENGTH;
    const rgba = colorOffset(options.backgroundColor, 1, 2);
    ctx.fillStyle = rgba;
    for (let i = 0; i < BIT_LENGTH; i++) {
        if (Number(bits[i])) {
            ctx.fillRect(i * chunkWidth, 0, chunkWidth, canvasHeight);
        }
    }
    return canvas;
}

export function writeMetaInfo(pixels: Uint8ClampedArray, options: Options) {
    const baseCanvas = putToCanvas(new ImageData(pixels, options.width, options.height));
    const headCanvas = createHeadMeta(options);
    const baseCtx = <CanvasRenderingContext2D>baseCanvas.getContext('2d');
    const dh = Math.floor(baseCanvas.width / headCanvas.width * headCanvas.height);
    baseCtx.drawImage(headCanvas, 0, 0, headCanvas.width, headCanvas.height, 0, 0, baseCanvas.width, dh);
    return baseCanvas;
}

function readHeadInfo(ctx: CanvasRenderingContext2D, width: number, ratio: number) {
    const chunkSize = Math.floor(width / BIT_LENGTH);
    const chunkValue = [];
    for (let i = 0; i < BIT_LENGTH; i++) {
        const imageData = ctx.getImageData(i * chunkSize, 0, chunkSize, 4);
        const x = Math.floor(chunkSize / 2);
        const y = 2;
        const index = (y * chunkSize + x) * 4;
        chunkValue.push(imageData.data[index] + imageData.data[index + 1] + imageData.data[index + 2]);
    }
    const [head] = chunkValue;
    const bits = chunkValue.map(v => v === head ? 0 : 1).join('');
    const vertical = parseInt(bits.slice(0, 8), 2);
    const size = parseInt(bits.slice(8, 16), 2);
    const sizeCout = parseInt(bits.slice(16), 2);
    return {
        vertical: !!vertical,
        size: Math.round(size * ratio),
        wdith: Math.round(size * sizeCout * ratio),
    };
}

const toGray = (data: ImageData) => {
    const calculateGray = (r: number, g: number, b: number) =>
        Math.floor(r * 0.299 + g * 0.587 + b * 0.114);
    for (let x = 0; x < data.width; x++) {
        for (let y = 0; y < data.height; y++) {
            const idx = (x + y * data.width) * 4;
            const r = data.data[idx + 0];
            const g = data.data[idx + 1];
            const b = data.data[idx + 2];
            const gray = calculateGray(r, g, b);
            data.data[idx + 0] = gray;
            data.data[idx + 1] = gray;
            data.data[idx + 2] = gray;
            data.data[idx + 3] = 255;
        }
    }
    return data;
};

// ???????????????????????????
const average = (data: Uint8ClampedArray) => {
    let sum = 0;
    // ???????????????????????????????????????????????????
    for (let i = 0; i < data.length - 1; i += 4) {
        sum += data[i];
    }
    return Math.round(sum / (data.length / 4));
};

// ????????????????????????
const otsu = (data: Uint8ClampedArray) => {
    let ptr = 0;
    let histData = Array(256).fill(0); // ??????0-256???????????????????????????????????????0
    let total = data.length;

    while (ptr < total) {
        let h = data[ptr++];
        histData[h]++;
    }

    let sum = 0; // ??????(?????????x??????)
    for (let i = 0; i < 256; i++) {
        sum += i * histData[i];
    }

    let wB = 0; // ?????????????????????????????????
    let wF = 0; // ?????????????????????????????????
    let sumB = 0; // ?????????????????????x???????????????
    let varMax = 0; // ???????????????????????????
    let threshold = 0; // ??????

    for (let t = 0; t < 256; t++) {
        wB += histData[t]; // ???????????????????????????????????????
        if (wB === 0) continue;
        wF = total - wB; // ???????????????????????????????????????
        if (wF === 0) break;

        sumB += t * histData[t]; // ???????????????x???????????????

        let mB = sumB / wB; // ???????????????????????????????????????
        let mF = (sum - sumB) / wF; // ???????????????????????????????????????

        let varBetween = wB * wF * (mB - mF) ** 2; // ????????????

        if (varBetween > varMax) {
            varMax = varBetween;
            threshold = t;
        }
    }

    return threshold;
};

// ?????????????????????????????????
function unitizeImageData(imageData: ImageData) {
    const grayImageData = toGray(imageData)
    const { width, height, data } = grayImageData;
    const threshold = otsu(data);
    const colors = data[0] > threshold ? [0, 255] : [255, 0];
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const index = (j * width + i) * 4;
            const v = data[index] > threshold ? colors[0] : colors[1]
            data[index] = v;
            data[index + 1] = v;
            data[index + 2] = v;
            data[index + 3] = 255;
        }
    }
    return imageData;
}

function binaryzationOutput(imageData: ImageData) {
    const grayImageData = toGray(imageData);
    const { width, height, data } = grayImageData;
    const threshold = average(data);
    const value = data[0] > threshold ? [0, 1] : [1, 0];
    const hash = new Uint8Array(width * height);
    for (let i = 0; i < width; i++) {
        for (let j = 0; j < height; j++) {
            const index = (j * width + i);
            const v = data[index * 4] > threshold ? value[0] : value[1];
            hash.set([v], index);
        }
    }
    return hash;
}
interface SplitOptions {
    width: number,
    height: number,
    size: number,
    fingerprint: number,
}

function resizeImageData(imageData: ImageData, inputSize: number, outputSize: number) {
    const inputCanvas = createCavans(inputSize, inputSize);
    const inputCtx = <CanvasRenderingContext2D>inputCanvas.getContext('2d');
    inputCtx.putImageData(imageData, 0, 0);
    const outputCavans = createCavans(outputSize, outputSize);
    const outputCtx = <CanvasRenderingContext2D>outputCavans.getContext('2d');
    outputCtx.drawImage(inputCanvas, 0, 0, inputSize, inputSize, 0, 0, outputSize, outputSize);
    const outputImageData = outputCtx.getImageData(0, 0, outputSize, outputSize);
    return outputImageData;
}

function splitGrid(ctx: CanvasRenderingContext2D, options: SplitOptions) {
    const {
        width,
        height,
        size,
        fingerprint,
    } = options;

    const w = Math.floor(width / size);
    const h = Math.floor(height / size);
    console.log({ w, h });
    const grids = Array.from({ length: w * h }).fill(null);
    // ?????? 1 ~ w - 1 ?????????????????????
    for (let i = 1; i < w - 1; i++) {
        for (let j = 1; j < h - 1; j++) {
            const imageData = ctx.getImageData(i * size, j * size, size, size);
            const resizeData = resizeImageData(imageData, size, fingerprint);
            const outputHash = binaryzationOutput(resizeData);
            const index = j * w + i;
            grids[index] = outputHash;
        }
    }
    return {
        grids: grids.filter(it => !!it),
        row: h - 2,
        col: w - 2,
    };
}

async function getImageFingerprint(url: string) {
    const image = await loadImage(url);
    const { naturalWidth, naturalHeight } = image;
    let canvasWidth = getLcm(naturalWidth, 24);
    let ratio = canvasWidth / naturalWidth;
    let canvasHeight = Math.round(ratio * naturalHeight);
    const area = canvasWidth * canvasHeight;
    // fix ios canvas max area size
    if (IS_IOS && area > MAX_IOS_AREA_SIZE) {
        const resizeRatio = MAX_IOS_AREA_SIZE / area;
        canvasWidth = Math.floor(canvasWidth * resizeRatio);
        canvasHeight = Math.floor(canvasHeight * resizeRatio);
        ratio = canvasWidth / naturalWidth;
    }

    // ???????????????
    if (area > MAX_CAVAS_AREA_SIZE) {
        const resizeRatio = MAX_CAVAS_AREA_SIZE / area;
        canvasWidth = Math.floor(canvasWidth * resizeRatio);
        canvasHeight = Math.floor(canvasHeight * resizeRatio);
        ratio = canvasWidth / naturalWidth;
    }

    const canvas = createCavans(canvasWidth, canvasHeight);
    const ctx = <CanvasRenderingContext2D>canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, naturalWidth, naturalHeight, 0, 0, canvasWidth, canvasHeight);
    const headMeta = readHeadInfo(ctx, canvasWidth, ratio);
    console.log('readHeadInfo', headMeta);
    const { grids, row, col } = splitGrid(ctx, {
        width: canvasWidth,
        height: canvasHeight,
        size: headMeta.size,
        fingerprint: 8,
    });
    return {
        hashList: grids,
        row,
        col,
        headMeta,
    };
}

const WORDS = 'abcdefghijklmnopqrstuvwxyz0123456789.-!?';

function createSymbols(hashList: Array<any>) {
    return hashList.map((hash, index) => {
        return {
            name: WORDS[index],
            value: hash,
        };
    });
}

const hammingDistance = (hash1: Uint8Array, hash2: Uint8Array) => {
    let count = 0;
    hash1.forEach((it, index) => {
        count += it ^ hash2[index];
    });
    return count;
};

function mapToSymbol(hashList: Array<any>, symbols: Array<any>) {
    return hashList.map(hash => {
        const isEmpty = hash.every((v: number) => v === hash[0]);
        if (isEmpty) {
            return ' ';
        }
        let diff = Number.MAX_SAFE_INTEGER;
        let target = ' ';
        symbols.forEach(symbol => {
            const distance = hammingDistance(hash, symbol.value);
            // ???????????????????????????????????????????????????
            if (distance < diff && distance < 5) {
                diff = distance;
                target = symbol.name;
            }
        });
        return target;
    });
}

function printfSymbol(words: Array<string>, options: any) {
    const { row, col, vertical } = options;
    console.log(words);
    if (words.every(w => w === ' ')) {
        return '??????????????????????????????????????????????????????';
    }
    let message = '';
    if (vertical) {
        for (let i = 0; i < col; i++) {
            for (let j = 0; j < row; j++) {
                const index = j * col + i;
                message += words[index];
            }
            message += '\n';
        }
    } else {
        for (let i = 0; i < row; i++) {
            for (let j = 0; j < col; j++) {
                const index = i * col + j;
                message += words[index];
            }
            message += '\n';
        }
    }
    return message;
}

export async function readMetaInfo(imageUrl: string, mapUrl: string) {
    const mapFingerprint = await getImageFingerprint(mapUrl);
    const symbols = createSymbols(mapFingerprint.hashList);
    const imageFingerprint = await getImageFingerprint(imageUrl);
    const words = mapToSymbol(imageFingerprint.hashList, symbols);
    return printfSymbol(words, {
        row: imageFingerprint.row,
        col: imageFingerprint.col,
        vertical: imageFingerprint.headMeta.vertical,
    });
}