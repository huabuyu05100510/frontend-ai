/**
 * 语音控制2048游戏 - React组件示例
 * 
 * 展示如何将语音识别集成到实际游戏中
 */

import { useEffect, useRef, useState } from 'react';
import { WebAudioCapture } from '@voice-kit/adapter-web';
import { DoubaoASRProvider } from '@voice-kit/provider-doubao';
import { Voice2048Controller, createVoiceGameController } from './voice-2048-controller';

export default function Voice2048Demo() {
  const [grid, setGrid] = useState<number[][]>(initializeGrid());
  const [score, setScore] = useState(0);
  const [listening, setListening] = useState(false);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  
  const captureRef = useRef<WebAudioCapture | null>(null);
  const controllerRef = useRef<Voice2048Controller | null>(null);

  // 初始化语音控制器
  useEffect(() => {
    controllerRef.current = createVoiceGameController({
      moveUp: () => handleMove('up'),
      moveDown: () => handleMove('down'),
      moveLeft: () => handleMove('left'),
      moveRight: () => handleMove('right'),
    });
  }, []);

  // 游戏逻辑
  const handleMove = (direction: 'up' | 'down' | 'left' | 'right') => {
    setLastCommand(direction);
    setGrid(prevGrid => {
      const result = moveGrid(prevGrid, direction);
      setScore(s => s + result.scoreGain);
      return result.grid;
    });
  };

  // 开始语音控制
  const startListening = async () => {
    try {
      // 1. 启动音频采集
      const capture = new WebAudioCapture({ 
        processorUrl: '/capture-processor.js',
        targetRate: 16000 
      });
      await capture.start();
      captureRef.current = capture;

      // 2. 连接ASR服务
      const provider = new DoubaoASRProvider({ 
        gatewayUrl: 'ws://localhost:8787/api/asr/doubao' 
      });
      const session = await provider.openStream({
        language: 'zh-CN',
        punctuation: false,  // 命令识别不需要标点
        diarization: false,  // 单人场景不需要说话人分离
        audioFormat: { sampleRate: 16000, encoding: 'pcm-s16le', channels: 1 },
      });

      setListening(true);

      // 3. 音频流 → ASR
      (async () => {
        for await (const chunk of capture.chunks()) {
          session.pushAudio(chunk.data);
        }
      })();

      // 4. ASR结果 → 命令识别
      (async () => {
        for await (const result of session.results()) {
          if (result.kind === 'partial' || result.kind === 'final') {
            const cmd = controllerRef.current?.process(result);
            if (cmd) {
              console.log(`✅ 命令触发: ${cmd.direction}`);
            }
          }
        }
      })();
    } catch (e) {
      console.error('启动失败:', e);
      setListening(false);
    }
  };

  const stopListening = async () => {
    await captureRef.current?.stop();
    captureRef.current = null;
    setListening(false);
  };

  return (
    <div className="game-container">
      <div className="controls">
        <button onClick={listening ? stopListening : startListening}>
          {listening ? '🛑 停止语音控制' : '🎤 开始语音控制'}
        </button>
        <div className="status">
          <span>分数: {score}</span>
          {lastCommand && <span>上次命令: {lastCommand}</span>}
        </div>
      </div>

      <div className="grid">
        {grid.map((row, i) => (
          <div key={i} className="row">
            {row.map((cell, j) => (
              <div key={j} className={`cell cell-${cell}`}>
                {cell || ''}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="help">
        <h3>语音命令：</h3>
        <ul>
          <li>上 / 向上 / 往上 / 尚 / 桑</li>
          <li>下 / 向下 / 往下</li>
          <li>左 / 向左 / 往左 / 作 / 坐</li>
          <li>右 / 向右 / 往右 / 又 / 有</li>
        </ul>
      </div>
    </div>
  );
}

// ============================================================================
// 游戏逻辑（简化版）
// ============================================================================

function initializeGrid(): number[][] {
  const grid = Array(4).fill(null).map(() => Array(4).fill(0));
  addRandomTile(grid);
  addRandomTile(grid);
  return grid;
}

function addRandomTile(grid: number[][]): void {
  const empty = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (grid[i][j] === 0) empty.push([i, j]);
    }
  }
  if (empty.length === 0) return;
  const [i, j] = empty[Math.floor(Math.random() * empty.length)];
  grid[i][j] = Math.random() < 0.9 ? 2 : 4;
}

function moveGrid(grid: number[][], direction: string): { grid: number[][]; scoreGain: number } {
  // 简化实现，实际游戏需要完整的移动逻辑
  const newGrid = grid.map(row => [...row]);
  let scoreGain = 0;
  
  // TODO: 实现完整的移动和合并逻辑
  
  addRandomTile(newGrid);
  return { grid: newGrid, scoreGain };
}
