/**
 * 北京真实景点 POI 数据集（含真实经纬度）。
 *
 * 数据来源：高德 / 百度地图公开 POI 坐标（手工抽取，非 API 拉取，无 key 需求）。
 * 用法：作为「景点穿越状态机」的输入。
 *
 * 真实业务里这层 = 滴滴行中导游 PRD 中的 POI 索引库（小红书/抖音/携程爬虫 → RAG）。
 * 本 demo 用静态数据集降低复现门槛，算法完全相同（Haversine / 围栏相交）。
 */

export interface Poi {
  id: string;
  name: string;
  category: '历史古迹' | '公园' | '博物馆' | '商业区' | '地标' | '宗教';
  lng: number; // 经度
  lat: number; // 纬度
  radiusKm: number; // 围栏半径
  intro: string; // 一句话亮点
}

export const BEIJING_POIS: Poi[] = [
  { id: 'poi_tiananmen', name: '天安门', category: '地标', lng: 116.39745, lat: 39.90872, radiusKm: 1, intro: '中国国家象征，明清皇城正门' },
  { id: 'poi_forbidden', name: '故宫', category: '历史古迹', lng: 116.39705, lat: 39.91620, radiusKm: 1, intro: '世界现存最大木质宫殿群' },
  { id: 'poi_jingshan', name: '景山公园', category: '公园', lng: 116.39580, lat: 39.92580, radiusKm: 1, intro: '俯瞰故宫全景的制高点' },
  { id: 'poi_beihai', name: '北海公园', category: '公园', lng: 116.38930, lat: 39.92550, radiusKm: 2, intro: '白塔与琼华岛，皇家园林' },
  { id: 'poi_houhai', name: '后海', category: '商业区', lng: 116.38340, lat: 39.94080, radiusKm: 2, intro: '胡同酒吧与银锭桥' },
  { id: 'poi_nanluoguxiang', name: '南锣鼓巷', category: '商业区', lng: 116.40320, lat: 39.93780, radiusKm: 1, intro: '元代胡同肌理，文青打卡地' },
  { id: 'poi_yonghe', name: '雍和宫', category: '宗教', lng: 116.41720, lat: 39.94720, radiusKm: 1, intro: '北京最大藏传佛教寺院' },
  { id: 'poi_confucius', name: '孔庙国子监', category: '历史古迹', lng: 116.41750, lat: 39.94930, radiusKm: 1, intro: '元明清三朝最高学府' },
  { id: 'poi_ditan', name: '地坛公园', category: '公园', lng: 116.42150, lat: 39.95230, radiusKm: 1, intro: '方泽坛，明清帝王祭地之所' },
  { id: 'poi_sanjie', name: '三里屯', category: '商业区', lng: 116.45540, lat: 39.93360, radiusKm: 1, intro: '北京夜生活地标' },
  { id: 'poi_chaoyangpark', name: '朝阳公园', category: '公园', lng: 116.48030, lat: 39.93990, radiusKm: 2, intro: '北京四环内最大城市公园' },
  { id: 'poi_cbd', name: '国贸 CBD', category: '商业区', lng: 116.46440, lat: 39.90890, radiusKm: 1, intro: '中央商务区，中国尊' },
  { id: 'poi_wangfujing', name: '王府井', category: '商业区', lng: 116.41060, lat: 39.91410, radiusKm: 1, intro: '中华第一商业街' },
  { id: 'poi_temple_heaven', name: '天坛', category: '历史古迹', lng: 116.40720, lat: 39.88220, radiusKm: 2, intro: '明清祭天祈年殿' },
  { id: 'poi_qianmen', name: '前门大街', category: '商业区', lng: 116.39720, lat: 39.89910, radiusKm: 1, intro: '老北京风貌商业街' },
  { id: 'poi_dashilar', name: '大栅栏', category: '商业区', lng: 116.39370, lat: 39.89590, radiusKm: 1, intro: '百年老字号聚集地' },
  { id: 'poi_summer_palace', name: '颐和园', category: '历史古迹', lng: 116.29500, lat: 39.99990, radiusKm: 3, intro: '皇家园林，万寿山昆明湖' },
  { id: 'poi_yuanmingyuan', name: '圆明园', category: '历史古迹', lng: 116.29850, lat: 40.00800, radiusKm: 3, intro: '西洋楼遗址，国耻纪念' },
  { id: 'poi_xiangshan', name: '香山公园', category: '公园', lng: 116.18650, lat: 39.99210, radiusKm: 2, intro: '秋日红叶最佳观赏地' },
  { id: 'poi_bagua', name: '八大处', category: '公园', lng: 116.14300, lat: 39.96330, radiusKm: 2, intro: '长安寺灵光寺等八处古刹' },
  { id: 'poi_bird_nest', name: '鸟巢', category: '地标', lng: 116.39720, lat: 39.99290, radiusKm: 1, intro: '奥运主场馆，钢结构奇迹' },
  { id: 'poi_water_cube', name: '水立方', category: '地标', lng: 116.39150, lat: 39.99310, radiusKm: 1, intro: '奥运游泳馆，蓝色泡泡墙' },
  { id: 'poi_olympic_forest', name: '奥林匹克森林公园', category: '公园', lng: 116.38770, lat: 40.02130, radiusKm: 3, intro: '北京最大城市森林公园' },
  { id: 'poi_tsinghua', name: '清华园', category: '历史古迹', lng: 116.32670, lat: 40.00440, radiusKm: 1, intro: '百年学府，二校门打卡' },
  { id: 'poi_pku', name: '北京大学', category: '历史古迹', lng: 116.31000, lat: 39.99210, radiusKm: 1, intro: '未名湖博雅塔' },
  { id: 'poi_zhongguancun', name: '中关村', category: '商业区', lng: 116.31720, lat: 39.98380, radiusKm: 1, intro: '中国硅谷' },
  { id: 'poi_old_summer_palace', name: '北京动物园', category: '公园', lng: 116.34200, lat: 39.94180, radiusKm: 1, intro: '中国最早动物园' },
  { id: 'poi_xidan', name: '西单', category: '商业区', lng: 116.37420, lat: 39.90760, radiusKm: 1, intro: '年轻人时尚商圈' },
  { id: 'poi_national_museum', name: '国家博物馆', category: '博物馆', lng: 116.40370, lat: 39.90520, radiusKm: 1, intro: '亚洲最大博物馆' },
  { id: 'poi_national_art', name: '中国美术馆', category: '博物馆', lng: 116.40820, lat: 39.92500, radiusKm: 1, intro: '中国近现代美术殿堂' },
  { id: 'poi_lama_temple', name: '大钟寺', category: '宗教', lng: 116.33810, lat: 39.96400, radiusKm: 1, intro: '永乐大钟出土地' },
  { id: 'poi_zoo_market', name: '北京海洋馆', category: '博物馆', lng: 116.34300, lat: 39.94400, radiusKm: 1, intro: '内陆最大海洋馆' },
  { id: 'poi_xianghe', name: '国家大剧院', category: '地标', lng: 116.39050, lat: 39.90580, radiusKm: 1, intro: '钛金属蛋形穹顶' },
  { id: 'poi_mao_maos', name: '毛主席纪念堂', category: '地标', lng: 116.39720, lat: 39.90500, radiusKm: 1, intro: '天安门广场南侧' },
  { id: 'poi_huairou', name: '慕田峪长城', category: '历史古迹', lng: 116.57000, lat: 40.43100, radiusKm: 5, intro: '长城精华段，少人景美' },
];
