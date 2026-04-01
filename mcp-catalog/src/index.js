import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createCatalogServer } from './catalog.js';

const server = createCatalogServer();
const transport = new StdioServerTransport();
await server.connect(transport);
