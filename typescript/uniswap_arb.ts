import WebSocket from "ws";
import { TypedTransaction } from "@ethereumjs/tx";
import { Client as FiberClient } from "fiber-ts";
import { createPublicClient, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const ECHO_WS_URL = "wss://echo-rpc.chainbound.io/ws";
const FIBER_URL = "beta.fiberapi.io:8080";

async function uniswapArbitrage() {
  const fiberApiKey = process.env.FIBER_TEST_KEY;
  const privateKey = process.env.ETHEREUM_TEST_PK;

  if (!fiberApiKey || !privateKey) {
    throw new Error("Please set your Fiber API key and private key env vars");
  }
  console.log("Starting Uniswap Arbitrage Bot example...");

  const provider = createPublicClient({
    transport: webSocket("wss://eth.llamarpc.com"),
    chain: mainnet,
  });
  
  const account = privateKeyToAccount('0x...')

  const echoClient = new WebSocket(ECHO_WS_URL, {
    headers: { "x-api-key": fiberApiKey },
  });
  console.log("Connected to Echo");

  const fiberClient = new FiberClient(FIBER_URL, fiberApiKey);
  await fiberClient.waitForReady(10);
  console.log("Connected to Fiber");

  // listen for receipt notifications from Echo
  echoClient.on("message", async (data: string) => {
    const { receiptNotification } = JSON.parse(data);
    console.log("Received receipt from Echo:", receiptNotification);
  });

  // for demo purposes
  let canSend = true;

  // subscribe to pending transactions
  fiberClient.subscribeNewTxs().on("data", async (tx: TypedTransaction) => {
    console.log("Received new transaction from Fiber:", toHexString(tx.hash()));

    // for demo purposes, only send one transaction. In production, you would
    // want to check for conditions that would make the arbitrage profitable
    if (!canSend) return;
    canSend = false;

    const backrun = 

    const nextBlockNumber = Number(await provider.getBlockNumber()) + 1;

    // send a bundle to Echo with the transaction in the mempool and a backrun
    const bundle = {
      txs: [tx.serialize(), ],
      blockNumber: nextBlockNumber,
      usePublicMempool: false,
    };

    echoClient.send(
      JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "eth_sendBundle",
        params: [bundle],
      })
    );
  });
}

function toHexString(byteArray: Uint8Array): string {
  return (
    "0x" +
    Array.from(byteArray, (byte) => {
      return ("0" + (byte & 0xff).toString(16)).slice(-2);
    }).join("")
  );
}

uniswapArbitrage()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
