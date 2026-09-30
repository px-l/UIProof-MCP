#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createServer } from './server.js';
const {values}=parseArgs({options:{root:{type:'string'}}});
const root=path.resolve(values.root??process.cwd());
await createServer(root).connect(new StdioServerTransport());
