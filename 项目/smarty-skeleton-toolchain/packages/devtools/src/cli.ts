#!/usr/bin/env node
import { startServer } from './server';

const args = process.argv.slice(2);

if (args[0] === 'start') {
  const port = args[1] ? parseInt(args[1], 10) : 3001;
  startServer(port);
} else {
  console.log('Usage: devtools start [port]');
}
