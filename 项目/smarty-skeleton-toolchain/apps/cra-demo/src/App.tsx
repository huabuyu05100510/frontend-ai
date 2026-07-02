import React, { useEffect, useState } from 'react';
import logo from './logo.svg';
import {SmartySkeleton} from '@smarty-skeleton-toolchain/react'
import './App.css';

function App() {
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    setTimeout(()=>{
      setLoading(false)
    },1000)
  },[])
  return (
    <SmartySkeleton id='ske-test' loading={loading}> 
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
        
      </header>
    </div>
   </SmartySkeleton>
  );
}

export default App;
