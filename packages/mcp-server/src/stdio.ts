import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";

import { DstarMcpBroker, type BrokerOptions } from "./broker.js";
import { createDstarMcpServer } from "./server.js";

export interface ServeDstarStdioOptions {
  readonly broker: BrokerOptions;
  readonly onerror?: (error: Error) => void;
}

export async function serveDstarStdio(
  options: ServeDstarStdioOptions,
): Promise<StdioServerHandle> {
  const broker = await DstarMcpBroker.create(options.broker);
  return serveStdio(() => createDstarMcpServer(broker), {
    legacy: "serve",
    ...(options.onerror ? { onerror: options.onerror } : {}),
  });
}
