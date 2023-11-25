import WebSocket from "ws";
import { TypedTransaction } from "@ethereumjs/tx";
import { Client as FiberClient } from "fiber-ts";
import { createPublicClient, createWalletClient, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const ECHO_WS_URL = "wss://echo-rpc.chainbound.io/ws";
const RPC_WS_URL = "wss://eth.merkle.io";
const FIBER_URL = "beta.fiberapi.io:8080";

async function uniswapArbitrage() {
  const fiberApiKey = process.env.FIBER_TEST_KEY;
  const privateKey = process.env.ETHEREUM_TEST_PK;

  if (!fiberApiKey || !privateKey) {
    throw new Error("Please set your Fiber API key and private key env vars");
  }
  console.log("Starting Uniswap Arbitrage Bot example...");

  const provider = createPublicClient({
    transport: webSocket(RPC_WS_URL),
    chain: mainnet,
  });

  const account = privateKeyToAccount(`0x${privateKey}`);
  const walletClient = createWalletClient({
    transport: webSocket(RPC_WS_URL),
    chain: mainnet,
    account,
  });

  const echoClient = new WebSocket(ECHO_WS_URL, {
    headers: { "x-api-key": fiberApiKey },
  });
  console.log("Connected to Echo");

  const fiberClient = new FiberClient(FIBER_URL, fiberApiKey);
  await fiberClient.waitForReady(10);
  console.log("Connected to Fiber");

  // listen for receipt notifications from Echo
  echoClient.on("message", async (data: Buffer) => {
    let text = data.toString("utf-8");
    console.log("Received message from Echo:", text);
  });

  // for demo purposes
  let canSend = true;

  // subscribe to pending transactions
  fiberClient.subscribeNewTxs().on("data", async (tx: TypedTransaction) => {
    // for demo purposes, only send one transaction. In production, you would
    // want to check for conditions that would make the arbitrage profitable
    if (!canSend) return;
    canSend = false;

    console.log("Received new transaction from Fiber:", toHexString(tx.hash()));
    console.log("Sending arbitrage bundle...");

    // we create a fake backrun tx (sending 42 wei to ourselves) for demo purposes
    const backrun = await walletClient.prepareTransactionRequest({
      to: account.address,
      value: BigInt(42),
    });
    const backrunRawSigned = await walletClient.signTransaction(backrun);

    const nextBlockNumber = Number(await provider.getBlockNumber()) + 1;

    // send a bundle to Echo with the transaction in the mempool and a backrun
    const bundle = {
      txs: [toHexString(tx.serialize()), backrunRawSigned],
      blockNumber: nextBlockNumber,
      usePublicMempool: false,
      awaitReceipt: true,
      awaitReceiptTimeoutMs: 60_000,
      mevBuilders: ["titan", "rsync", "beaverbuild"],
    };

    const rpcRequest = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendBundle",
      params: [bundle],
    });

    console.log("Sending bundle to Echo:", rpcRequest);
    echoClient.send(rpcRequest);
  });

  // wait instead of exiting
  await new Promise(() => {});
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
