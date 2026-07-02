import React, { useState } from 'react';
// import SmartySkeleton from 'smarty-skeleton-toolchain/src/SmartySkeleton';

const App: React.FC = () => {
  const [loading, setLoading] = useState(true);

  return (
    <div style={{ padding: '20px' }}>
      <h1>CRA Demo for SmartySkeleton</h1>
      <button onClick={() => setLoading(!loading)}>
        Toggle Loading
      </button>

      <div style={{ marginTop: '20px' }}>
        {/* <SmartySkeleton id="demo-skeleton" loading={loading}> */}
          <div style={{ width: '300px', height: '200px', background: '#87ceeb' }}>
            Real Content Here
          </div>
        {/* </SmartySkeleton> */}
      </div>
    </div>
  );
};

export default App;
