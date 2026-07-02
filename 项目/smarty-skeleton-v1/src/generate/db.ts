// 打开数据库，并处理版本升级逻辑
// db.ts

// db.ts
const DB_NAME = "SmartySkeletonDB";
const STORE_NAME = "dslStore";

// ---------- 关键：缓存 DB 实例 ----------
let cachedDB: IDBDatabase | null = null;

// 打开数据库（只打开一次）
export function openDB(): Promise<IDBDatabase> {
  if (cachedDB) {
    return Promise.resolve(cachedDB);
  }

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => {
      cachedDB = req.result;

      // 防止浏览器自动关闭 DB
      cachedDB.onclose = () => {
        cachedDB = null;
      };

      resolve(cachedDB);
    };

    req.onerror = () => reject(req.error);
  });
}

// ---------- 读取 ----------
export async function getItem(key: string): Promise<string | null> {
  console.log(performance.now(), "start read");

  const db = await openDB(); // ⭐ 再也不会慢了（1ms 内直接返回 cachedDB）

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);

    req.onsuccess = () => {
      console.log(performance.now(), "end read");
      if (req.result) resolve(decompressDSL(req.result));
      else resolve(null);
    };
    req.onerror = () => reject(req.error);
  });
}

// ---------- 写入 ----------
export async function setItem(key: string, value: any): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    // 打印大小
    console.log(
      "原始DSL大小:",
      (JSON.stringify(value).length / 1024).toFixed(2),
      "KB"
    );
    const saveValue = compressDSL(value);
    // const compressed = db.compressDSL(dsl);
    console.log("压缩后DSL大小:", (saveValue.length / 1024).toFixed(2), "KB");

    tx.objectStore(STORE_NAME).put(compressDSL(value), key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- 删除 ----------
export async function removeItem(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// // LZW + Base64 压缩
// export function lzwCompressToBase64(input: string): string {
//   const dict: Record<string, number> = {};
//   for (let i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;
//   let dictSize = 256;
//   let w = '';
//   const resultCodes: number[] = [];

//   for (let i = 0; i < input.length; i++) {
//     const c = input.charAt(i);
//     const wc = w + c;
//     if (dict.hasOwnProperty(wc)) {
//       w = wc;
//     } else {
//       resultCodes.push(dict[w]);
//       dict[wc] = dictSize++;
//       w = c;
//     }
//   }
//   if (w !== '') resultCodes.push(dict[w]);

//   const bytes = new Uint8Array(resultCodes.length * 2);
//   for (let i = 0; i < resultCodes.length; i++) {
//     const code = resultCodes[i];
//     bytes[i * 2] = (code >> 8) & 0xff;
//     bytes[i * 2 + 1] = code & 0xff;
//   }

//   let binary = '';
//   const chunk = 0x8000;
//   for (let i = 0; i < bytes.length; i += chunk) {
//     binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
//   }
//   return btoa(binary);
// }

// LZW + Base64 解压
// export function lzwDecompressFromBase64(b64: string): string {
//   const binary = atob(b64);
//   const bytes = new Uint8Array(binary.length);
//   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

//   const codes: number[] = [];
//   for (let i = 0; i < bytes.length; i += 2) {
//     const hi = bytes[i];
//     const lo = bytes[i + 1];
//     codes.push((hi << 8) | lo);
//   }

//   const dict: Record<number, string> = {};
//   let dictSize = 256;
//   for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);

//   let w = String.fromCharCode(codes[0]);
//   let result = w;
//   for (let i = 1; i < codes.length; i++) {
//     const k = codes[i];
//     let entry = '';
//     if (dict[k]) entry = dict[k];
//     else if (k === dictSize) entry = w + w.charAt(0);
//     else throw new Error('Bad LZW code: ' + k);
//     result += entry;
//     dict[dictSize++] = w + entry.charAt(0);
//     w = entry;
//   }
//   return result;
// }

// 兼容旧数据
export function encodeDSL(obj: any): string {
  return lzwCompressToBase64(JSON.stringify(obj));
}

export function decodeDSL(s: string): any {
  try {
    return JSON.parse(lzwDecompressFromBase64(s));
  } catch {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }
}
// LZW + Base64 压缩
function lzwCompressToBase64(input: string): string {
  const dict: Record<string, number> = {};
  for (let i = 0; i < 256; i++) dict[String.fromCharCode(i)] = i;
  let dictSize = 256,
    w = "";
  const result: number[] = [];

  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i),
      wc = w + c;
    if (dict[wc] !== undefined) w = wc;
    else {
      result.push(dict[w]);
      dict[wc] = dictSize++;
      w = c;
    }
  }
  if (w) result.push(dict[w]);

  const bytes = new Uint8Array(result.length * 2);
  for (let i = 0; i < result.length; i++) {
    bytes[i * 2] = (result[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = result[i] & 0xff;
  }

  let binary = "",
    chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

function lzwDecompressFromBase64(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const codes: number[] = [];
  for (let i = 0; i < bytes.length; i += 2)
    codes.push((bytes[i] << 8) | bytes[i + 1]);

  const dict: Record<number, string> = {};
  for (let i = 0; i < 256; i++) dict[i] = String.fromCharCode(i);
  let dictSize = 256,
    w = String.fromCharCode(codes[0]),
    result = w;

  for (let i = 1; i < codes.length; i++) {
    const k = codes[i];
    let entry = dict[k] || (k === dictSize ? w + w[0] : "");
    result += entry;
    dict[dictSize++] = w + entry[0];
    w = entry;
  }
  return result;
}
// compressDSL.ts
// compressDSL.ts

/// ---------- 推荐：稳妥兼容的 compressDSL / decompressDSL ----------
// 输入: 原始 SkeletonDSL 对象
// compressDSL 返回 base64 字符串（兼容你现有 db.setItem 接受字符串的情况）
// decompressDSL 接受 base64 字符串（老数据也回退到 JSON 解析）
// binaryDSL.ts
// 完整二进制压缩 + 解压实现（无第三方依赖）
// binaryDSL.ts
// 极致压缩 + 二进制 + LZW + Base64（无需第三方依赖）

type BoxNodeDSL = {
  positionInfo: {
    l: number;
    t: number;
    w: number;
    h: number;
    r?: number;
    b?: number;
  };
  borderRadius?: string;
  background?: string;
  backgroundColor?: string;
  noChild?: boolean;
  borderWidth?: string;
  borderStyle?: string;
  borderColor?: string;
};

type SkeletonDSL = {
  boxes: BoxNodeDSL[];
  bgs: BoxNodeDSL[];
  borders: BoxNodeDSL[];
  width: number;
  height: number;
};

// -------------------- 二进制极致压缩 --------------------
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function pushUint8(arr: number[], v: number) {
  arr.push(v & 0xff);
}
function pushUint16(arr: number[], v: number) {
  arr.push((v >> 8) & 0xff, v & 0xff);
}
function pushUint32(arr: number[], v: number) {
  arr.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}
function readUint16(view: Uint8Array, offset: number) {
  return (view[offset] << 8) | view[offset + 1];
}
function readUint32(view: Uint8Array, offset: number) {
  return (
    (view[offset] * 2 ** 24 +
      view[offset + 1] * 2 ** 16 +
      view[offset + 2] * 2 ** 8 +
      view[offset + 3]) >>>
    0
  );
}

function buildDicts(dsl: SkeletonDSL) {
  const dict = {
    backgrounds: [] as string[],
    borderRadius: [] as string[],
    borderWidth: [] as string[],
    borderStyle: [] as string[],
    borderColor: [] as string[],
  };
  const pushIf = (arr: string[], val?: string) => {
    if (!val) return -1;
    const idx = arr.indexOf(val);
    if (idx !== -1) return idx;
    arr.push(val);
    return arr.length - 1;
  };
  const collect = (b: BoxNodeDSL) => {
    pushIf(dict.backgrounds, b.background || b.backgroundColor);
    pushIf(dict.borderRadius, b.borderRadius);
    pushIf(dict.borderWidth, b.borderWidth);
    pushIf(dict.borderStyle, b.borderStyle);
    pushIf(dict.borderColor, b.borderColor);
  };
  [...dsl.boxes, ...dsl.bgs, ...dsl.borders].forEach(collect);
  return dict;
}

function pushItem(arr: number[], dict: any, item: BoxNodeDSL) {
  const toInt = (v?: number) => Math.round((v || 0) * 100);
  const { l, t, w, h } = item.positionInfo;
  pushUint32(arr, toInt(l));
  pushUint32(arr, toInt(t));
  pushUint32(arr, toInt(w));
  pushUint32(arr, toInt(h));

  const idxOrNone = (arrName: keyof typeof dict, val?: string) => {
    if (val === undefined || val === null) return 0xffff;
    const idx = dict[arrName].indexOf(val);
    return idx >= 0 ? idx : 0xffff;
  };

  pushUint16(
    arr,
    idxOrNone("backgrounds", item.background ?? item.backgroundColor)
  );
  pushUint16(arr, idxOrNone("borderRadius", item.borderRadius));
  pushUint16(arr, idxOrNone("borderWidth", item.borderWidth));
  pushUint16(arr, idxOrNone("borderStyle", item.borderStyle));
  pushUint16(arr, idxOrNone("borderColor", item.borderColor));
  pushUint8(arr, item.noChild ? 1 : 0);
}

function readItemAt(
  view: Uint8Array,
  offsetRef: { off: number },
  dict: any
): BoxNodeDSL {
  const off = offsetRef.off;
  const l = readUint32(view, off);
  offsetRef.off += 4;
  const t = readUint32(view, off + 4);
  offsetRef.off += 4;
  const w = readUint32(view, off + 8);
  offsetRef.off += 4;
  const h = readUint32(view, off + 12);
  offsetRef.off += 4;

  const bgIdx = readUint16(view, offsetRef.off);
  offsetRef.off += 2;
  const radiusIdx = readUint16(view, offsetRef.off);
  offsetRef.off += 2;
  const bwIdx = readUint16(view, offsetRef.off);
  offsetRef.off += 2;
  const bsIdx = readUint16(view, offsetRef.off);
  offsetRef.off += 2;
  const bcIdx = readUint16(view, offsetRef.off);
  offsetRef.off += 2;

  const noChild = !!view[offsetRef.off];
  offsetRef.off += 1;

  const safeGet = (arr: string[], idx: number) =>
    idx >= 0 && idx < arr.length ? arr[idx] : undefined;

  return {
    positionInfo: { l: l / 100, t: t / 100, w: w / 100, h: h / 100 },
    background: safeGet(dict.backgrounds, bgIdx),
    backgroundColor: safeGet(dict.backgrounds, bgIdx),
    borderRadius: safeGet(dict.borderRadius, radiusIdx),
    borderWidth: safeGet(dict.borderWidth, bwIdx),
    borderStyle: safeGet(dict.borderStyle, bsIdx),
    borderColor: safeGet(dict.borderColor, bcIdx),
    noChild,
  };
}

export function compressDSLBinaryExtreme(dsl: SkeletonDSL): Uint8Array {
  const out: number[] = [];
  out.push(0x53, 0x53, 0x44, 0x42);
  out.push(0x01); // 'SSDB', version
  pushUint16(out, dsl.boxes.length);
  pushUint16(out, dsl.bgs.length);
  pushUint16(out, dsl.borders.length);
  const dict = buildDicts(dsl);
  [
    "backgrounds",
    "borderRadius",
    "borderWidth",
    "borderStyle",
    "borderColor",
  ].forEach((k) => pushUint16(out, dict[k].length));
  pushUint32(out, Math.round(dsl.width * 100));
  pushUint32(out, Math.round(dsl.height * 100));
  const pushString = (s: string) => {
    const b = textEncoder.encode(s);
    pushUint16(out, b.length);
    for (let i = 0; i < b.length; i++) out.push(b[i]);
  };
  [
    "backgrounds",
    "borderRadius",
    "borderWidth",
    "borderStyle",
    "borderColor",
  ].forEach((k) => dict[k].forEach(pushString));
  [...dsl.boxes, ...dsl.bgs, ...dsl.borders].forEach((item) =>
    pushItem(out, dict, item)
  );
  return new Uint8Array(out);
}

function readStringAt(view: Uint8Array, offsetRef: { off: number }): string {
  const len = readUint16(view, offsetRef.off);
  offsetRef.off += 2;
  const bytes = view.slice(offsetRef.off, offsetRef.off + len);
  offsetRef.off += len;
  return textDecoder.decode(bytes);
}

export function decompressDSLBinaryExtreme(
  blob: Uint8Array | ArrayBuffer
): SkeletonDSL | null {
  const view = blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob;
  if (
    view.length < 16 ||
    view[0] != 0x53 ||
    view[1] != 0x53 ||
    view[2] != 0x44 ||
    view[3] != 0x42
  )
    return null;
  const version = view[4];
  if (version !== 1)
    throw new Error("Unsupported binary DSL version:" + version);
  let off = 5;
  const boxesCount = readUint16(view, off);
  off += 2;
  const bgsCount = readUint16(view, off);
  off += 2;
  const bordersCount = readUint16(view, off);
  off += 2;
  const bgDictLen = readUint16(view, off);
  off += 2;
  const radDictLen = readUint16(view, off);
  off += 2;
  const bwDictLen = readUint16(view, off);
  off += 2;
  const bsDictLen = readUint16(view, off);
  off += 2;
  const bcDictLen = readUint16(view, off);
  off += 2;
  const width100 = readUint32(view, off);
  off += 4;
  const height100 = readUint32(view, off);
  off += 4;
  const dict: any = {
    backgrounds: [],
    borderRadius: [],
    borderWidth: [],
    borderStyle: [],
    borderColor: [],
  };
  const offsetRef = { off };
  for (let i = 0; i < bgDictLen; i++)
    dict.backgrounds.push(readStringAt(view, offsetRef));
  for (let i = 0; i < radDictLen; i++)
    dict.borderRadius.push(readStringAt(view, offsetRef));
  for (let i = 0; i < bwDictLen; i++)
    dict.borderWidth.push(readStringAt(view, offsetRef));
  for (let i = 0; i < bsDictLen; i++)
    dict.borderStyle.push(readStringAt(view, offsetRef));
  for (let i = 0; i < bcDictLen; i++)
    dict.borderColor.push(readStringAt(view, offsetRef));
  off = offsetRef.off;
  const boxes: BoxNodeDSL[] = [];
  const bgs: BoxNodeDSL[] = [];
  const borders: BoxNodeDSL[] = [];
  const readItems = (count: number, target: BoxNodeDSL[]) => {
    for (let i = 0; i < count; i++)
      target.push(readItemAt(view, offsetRef, dict));
  };
  readItems(boxesCount, boxes);
  readItems(bgsCount, bgs);
  readItems(bordersCount, borders);
  return {
    boxes,
    bgs,
    borders,
    width: width100 / 100,
    height: height100 / 100,
  };
}

// -------------------- LZW 压缩 --------------------
export function lzwEncode(u8: Uint8Array): Uint8Array {
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  const data = Array.from(u8)
    .map((v) => String.fromCharCode(v))
    .join("");
  let w = "";
  let code = 256;
  const out: number[] = [];
  for (let c of data) {
    const wc = w + c;
    if (dict.has(wc)) w = wc;
    else {
      out.push(dict.get(w)!);
      dict.set(wc, code++);
      w = c;
    }
  }
  if (w !== "") out.push(dict.get(w)!);
  const result = new Uint8Array(out.length * 2);
  for (let i = 0; i < out.length; i++) {
    result[i * 2] = (out[i] >> 8) & 0xff;
    result[i * 2 + 1] = out[i] & 0xff;
  }
  return result;
}

export function lzwDecode(u8: Uint8Array): Uint8Array {
  const codes: number[] = [];
  for (let i = 0; i < u8.length; i += 2) codes.push((u8[i] << 8) | u8[i + 1]);
  const dict = new Map<number, string>();
  for (let i = 0; i < 256; i++) dict.set(i, String.fromCharCode(i));
  let w = String.fromCharCode(codes[0]);
  let result = w;
  let code = 256;
  for (let i = 1; i < codes.length; i++) {
    let k = codes[i];
    let entry: string;
    if (dict.has(k)) entry = dict.get(k)!;
    else if (k === code) entry = w + w[0];
    else throw new Error("Invalid LZW code");
    result += entry;
    dict.set(code++, w + entry[0]);
    w = entry;
  }
  const out = new Uint8Array(result.length);
  for (let i = 0; i < result.length; i++) out[i] = result.charCodeAt(i);
  return out;
}

// -------------------- 极致压缩 + LZW --------------------
export function compressDSLBinaryUltra(dsl: SkeletonDSL): Uint8Array {
  return lzwEncode(compressDSLBinaryExtreme(dsl));
}

export function decompressDSLBinaryUltra(
  blob: Uint8Array | ArrayBuffer
): SkeletonDSL | null {
  const u8 = blob instanceof ArrayBuffer ? new Uint8Array(blob) : blob;
  return decompressDSLBinaryExtreme(lzwDecode(u8));
}

// -------------------- Base64 helpers --------------------
export function ultraToBase64(dsl: SkeletonDSL): string {
  return btoa(String.fromCharCode(...compressDSLBinaryUltra(dsl)));
}

export function base64ToUltra(b64: string): SkeletonDSL | null {
  const u8 = new Uint8Array(
    atob(b64)
      .split("")
      .map((c) => c.charCodeAt(0))
  );
  return decompressDSLBinaryUltra(u8);
}

export const compressDSL = compressDSLBinaryUltra;
export const decompressDSL = decompressDSLBinaryUltra;
 