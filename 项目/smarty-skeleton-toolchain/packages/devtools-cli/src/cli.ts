#!/usr/bin/env node
import { startServer } from './server';

const desiredPort = Number(process.env.SMARTY_PORT) || 4399;

startServer(desiredPort)
  .then((port) => {
    console.log(`DevTools CLI started at http://localhost:${port}`);
  })
  .catch((err) => {
    console.error('Failed to start DevTools CLI:', err);
    process.exit(1);
  });
