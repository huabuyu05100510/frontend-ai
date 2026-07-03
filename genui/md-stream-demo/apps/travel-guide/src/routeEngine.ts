/**
 * 路线围栏相交引擎 —— 真实实现滴滴行中导游技术方案.md 的状态机。
 *
 * 核心算法（与原方案一一对应）：
 *   1. 快速矩形过滤（bbox prefilter）—— 避免遍历整个 POI list
 *   2. 状态机：外→内记录进入点，内→外记录离开点
 *   3. 距离计算用 Haversine 公式
 *   4. 多次穿越按产品约定只取第一次
 *
 * 输入：起点 / 终点 / 采样路径 / POI 库
 * 输出：POIFilterOutput[]（与原方案字段对齐）
 */

import type { Poi } from './poiDataset';

export interface LngLat {
  lng: number;
  lat: number;
}

export interface PoiFilterOutput {
  poi: Poi;
  enterPoint: LngLat;
  enterIndex: number;
  leavePoint: LngLat;
  leaveIndex: number;
  /** 围栏内停留的近似距离（km） */
  distanceInFenceKm: number;
  /** 从上一景点离开到当前景点离开的距离（km）—— 对齐原方案 lastPoiToExit */
  lastPoiToExitKm: number;
}

const EARTH_R_KM = 6371;

/**
 * 沿路径检测穿越的景点。
 *
 * @param path 采样路径（起点 → ... → 终点），建议 50-200 点
 * @param pois 景点库
 * @param opts 预留：可调围栏半径倍率
 */
export function filterAlongRoute(
  path: LngLat[],
  pois: Poi[],
  opts: { radiusMultiplier?: number } = {},
): PoiFilterOutput[] {
  if (path.length < 2) return [];
  const multiplier = opts.radiusMultiplier ?? 1;

  // 1. bbox prefilter：路径的经纬度边界
  const bbox = computeBBox(path);

  // 2. 候选 POI = 与 bbox 外扩 max(radius) 相交
  const maxRadiusKm = Math.max(...pois.map((p) => p.radiusKm)) * multiplier;
  const expanded = expandBBox(bbox, maxRadiusKm);
  const candidates = pois.filter((p) => poiInBBox(p, expanded));
  if (candidates.length === 0) return [];

  // 3. 状态机：每个 POI 一份「是否在围栏内」状态
  const results: PoiFilterOutput[] = [];
  const state = new Map<string, boolean>();
  const firstEnter = new Map<string, { idx: number; pt: LngLat }>();
  for (const p of candidates) state.set(p.id, false);

  for (let i = 0; i < path.length; i++) {
    const pt = path[i]!;
    for (const poi of candidates) {
      const inside = haversineKm(pt.lat, pt.lng, poi.lat, poi.lng) <= poi.radiusKm * multiplier;
      const prevInside = state.get(poi.id) ?? false;
      if (!prevInside && inside) {
        // 外 → 内：进入
        state.set(poi.id, true);
        if (!firstEnter.has(poi.id)) {
          firstEnter.set(poi.id, { idx: i, pt });
        }
      } else if (prevInside && !inside) {
        // 内 → 外：离开（仅记录第一次完整进出）
        const enter = firstEnter.get(poi.id);
        if (enter && !results.find((r) => r.poi.id === poi.id)) {
          results.push({
            poi,
            enterPoint: enter.pt,
            enterIndex: enter.idx,
            leavePoint: pt,
            leaveIndex: i,
            distanceInFenceKm: pathDistanceKm(path.slice(enter.idx, i + 1)),
            lastPoiToExitKm: 0, // 后处理填
          });
        }
        state.set(poi.id, false);
      }
    }
  }

  // 4. 终点仍围栏内：补全离开事件（与原方案一致）
  for (const poi of candidates) {
    if (state.get(poi.id) && !results.find((r) => r.poi.id === poi.id)) {
      const enter = firstEnter.get(poi.id);
      if (enter) {
        const endPt = path[path.length - 1]!;
        results.push({
          poi,
          enterPoint: enter.pt,
          enterIndex: enter.idx,
          leavePoint: endPt,
          leaveIndex: path.length - 1,
          distanceInFenceKm: pathDistanceKm(path.slice(enter.idx)),
          lastPoiToExitKm: 0,
        });
      }
    }
  }

  // 5. 排序：按进入顺序
  results.sort((a, b) => a.enterIndex - b.enterIndex);

  // 6. 计算 lastPoiToExitKm（从上一景点离开到当前景点离开）
  let prevLeaveIdx = 0;
  for (const r of results) {
    r.lastPoiToExitKm = pathDistanceKm(path.slice(prevLeaveIdx, r.leaveIndex + 1));
    prevLeaveIdx = r.leaveIndex;
  }

  return results;
}

/**
 * 用直线插值生成路径采样（真实业务里来自地图路线规划 API）。
 * 这里用 Linestring 等距插值，绕开了对地图 API 的依赖。
 */
export function sampleRoute(start: LngLat, end: LngLat, n: number): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({
      lng: start.lng + (end.lng - start.lng) * t,
      lat: start.lat + (end.lat - start.lat) * t,
    });
  }
  return out;
}

// ============================================================
// Haversine（球面距离，精度 ±0.5%，业务可接受）
// ============================================================

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_R_KM * c;
}

function pathDistanceKm(seg: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < seg.length; i++) {
    total += haversineKm(seg[i - 1]!.lat, seg[i - 1]!.lng, seg[i]!.lat, seg[i]!.lng);
  }
  return total;
}

// ============================================================
// bbox prefilter
// ============================================================

interface BBox { minLng: number; maxLng: number; minLat: number; maxLat: number; }

function computeBBox(path: LngLat[]): BBox {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const p of path) {
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return { minLng, maxLng, minLat, maxLat };
}

function expandBBox(b: BBox, expandKm: number): BBox {
  // 1 度 ≈ 111km
  const d = expandKm / 111;
  return { minLng: b.minLng - d, maxLng: b.maxLng + d, minLat: b.minLat - d, maxLat: b.maxLat + d };
}

function poiInBBox(p: Poi, b: BBox): boolean {
  return p.lng >= b.minLng && p.lng <= b.maxLng && p.lat >= b.minLat && p.lat <= b.maxLat;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
