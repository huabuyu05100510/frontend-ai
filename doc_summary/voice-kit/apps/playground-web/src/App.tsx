import { useState } from 'react';
import TranscribeDemo from './scenes/TranscribeDemo';
import ConverseDemo from './scenes/ConverseDemo';
import InputDemo from './scenes/InputDemo';
import ProviderStatus from './scenes/ProviderStatus';

type Tab = 'transcribe' | 'converse' | 'input' | 'providers';

export default function App() {
  const [tab, setTab] = useState<Tab>('transcribe');

  return (
    <div className="app">
      <h1>voice-kit playground</h1>
      <div className="sub">
        Cross-platform voice interaction platform · 4 pillars · 3 providers · 3 scenarios
      </div>
      <div className="tabs">
        <button className={`tab ${tab === 'transcribe' ? 'active' : ''}`} onClick={() => setTab('transcribe')}>
          实时转写 (飞书字幕)
        </button>
        <button className={`tab ${tab === 'converse' ? 'active' : ''}`} onClick={() => setTab('converse')}>
          实时对话 (Barge-in)
        </button>
        <button className={`tab ${tab === 'input' ? 'active' : ''}`} onClick={() => setTab('input')}>
          输入法短语音 (VAD)
        </button>
        <button className={`tab ${tab === 'providers' ? 'active' : ''}`} onClick={() => setTab('providers')}>
          Provider 状态
        </button>
      </div>
      <div className="panel">
        {tab === 'transcribe' && <TranscribeDemo />}
        {tab === 'converse' && <ConverseDemo />}
        {tab === 'input' && <InputDemo />}
        {tab === 'providers' && <ProviderStatus />}
      </div>
    </div>
  );
}
