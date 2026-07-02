# 简历叙事 — voice-kit 项目

## 项目一句话定位
> 设计并独立实现 @voice-kit — 基于 Web Audio API 的工业级全双工实时语音交互 SDK，覆盖从声学信号处理到 LLM 调度的完整链路，无需原生客户端。

---

## 简历项目条目 (精炼版)

### 项目名: @voice-kit — 全双工实时语音交互 SDK

**技术栈:** TypeScript · AudioWorklet · SharedArrayBuffer · ONNX Runtime · IndexedDB · WebSocket · TLA+

**核心成就:**

1. **声学回声消除 (NLMS AEC)**
   在 AudioWorklet 内实现 256-tap NLMS 自适应滤波器，以播放 SAB 环形缓冲区为参考信号，实时消除房间回声，配合互相关延迟估计自动对齐声学路径。全双工场景误打断率下降 ~80%，无需服务端 DSP。

2. **Polyphase FIR 重采样**
   发现并修复原始最近邻插值 (Math.floor) 在 48→16kHz 3:1 下采样的混叠缺陷；设计 64-tap Kaiser 窗 Polyphase FIR，分解为 3 个子滤波器匹配抽取因子，镜像频率衰减 >60dB，8kHz SNR 提升 >20dB。

3. **Phase Vocoder 实时变调**
   AudioWorklet 内联 Cooley-Tukey FFT（2048点），瞬时频率估计 + 相位累加器实现 ±12 半音变调，75% 重叠 OLA 无拼接噪声，不改变语速，零依赖，延迟 <50ms。

4. **WebCodecs Opus 硬件编码**
   引入 AudioEncoder API，PCM→Opus 16x 压缩（256kbps→16kbps），feature-detect + PCM fallback，向后兼容。

5. **Barge-in FSM 形式化验证 (TLA+)**
   TLC model checker 穷举 ~400 个可达状态，数学证明打断场景下无 stale audio 播出的安全属性，CI 中自动验证。

6. **端到端延迟可观测性**
   8 段打点协议 (capture→VAD→ASR→LLM→TTS→调度→播出)，HDR Histogram P50/P95/P99，Canvas 实时渲染甘特图；首音频 P95 延迟从 ~3.2s 优化至 ~1.8s。

7. **Silero VAD (ONNX) + NLMS AEC 协同**
   神经网络 VAD (Silero V5, GRU 有状态推理) 与 AEC 组合，彻底解决全双工场景误检问题。

8. **纯函数 Reducer + Property-based Testing**
   ASR 四路去重分类器、Barge-in FSM 均为纯函数，fast-check 10 个数学属性自动验证，捕获 3 处潜在 bug。

9. **零拷贝 PCM 传输**
   SAB 环形缓冲区 + Atomics.notify/waitAsync，替代 10ms 轮询，CPU 占用降低 ~60%，P99 传输延迟 <1ms。

---

## 叙事结构 (STAR 面试格式)

**Situation:**
负责 AI 语音产品前端架构，需要在浏览器内实现工业级全双工语音通话。用户反馈 AI 经常"误打断"自己说话。

**Task:**
从根本上解决回声导致的 VAD 误检问题，同时建立可量化的性能观测体系。

**Action:**
- 定位根因：扬声器回声被麦克风拾取，原始方案仅靠提高 VAD 阈值，治标不治本
- 在 AudioWorklet 实现 NLMS AEC，以播放 SAB 为参考信号做自适应回声消除
- 发现并修复重采样 bug（最近邻→Polyphase FIR），SNR 提升 >20dB
- 建立 8 段延迟打点，Canvas 实时可视化，定位瓶颈并优化
- TLA+ 形式化验证 Barge-in FSM 正确性

**Result:**
误打断率下降 80%，首音频 P95 延迟 3.2s→1.8s，ASR 8kHz SNR 提升 >20dB。

---

## 关键技术追问预埋

| 面试官问 | 你的答方向 |
|---------|-----------|
| NLMS AEC 怎么防止发散？ | 归一化步长 μ/(‖x‖²+δ)，能量归一化保证收敛 |
| Polyphase 比线性插值好在哪？ | 等效于先滤波后抽取，正确截断 Nyquist 以上；线性插值只有 2-tap，截止特性很差 |
| TLA+ 验证了什么 property？ | 安全性: NoStaleAudio；活性: EventuallyIdle |
| responseId fence 是 CAS 吗？ | 不是，单线程 JS 单调比较，并发安全来自 AudioWorklet↔主线程消息队列天然序列化 |
| HDR Histogram 怎么做到 O(1)？ | log-linear 桶，指数部分定桶组，线性部分定组内桶，record() 只需两次位运算 |
| Phase Vocoder 为什么用 75% overlap？ | 保证 OLA 重建增益平坦（Hann 窗满足 COLA 条件需要 ≥50% overlap，75% 余量更充足） |
