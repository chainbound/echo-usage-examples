import WebSocket from "ws";
import { TypedTransaction } from "@ethereumjs/tx";
import { Client as FiberClient } from "fiber-ts";
import { createPublicClient, createWalletClient, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

const ECHO_WS_URL = "wss://echo-rpc.chainbound.io/ws";
const RPC_WS_URL = "wss://eth.merkle.io";
const FIBER_URL = "beta.fiberapi.io:8080";

async function telegramBotOperation() {
  const fiberApiKey = process.env.FIBER_TEST_KEY;
  const privateKey = process.env.ETHEREUM_TEST_PK;

  if (!fiberApiKey || !privateKey) {
    throw new Error("Please set your Fiber API key and private key env vars");
  }
  console.log("Starting Telegram Bot Operation example...");

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
    // want to check for user-defined conditions (i.e. new token launches, NFT mints, etc.)
    if (!canSend) return;
    canSend = false;

    console.log("Received new transaction from Fiber:", toHexString(tx.hash()));
    console.log("Sending bundle...");

    const erc20Approval = await walletClient.prepareTransactionRequest({
      to: account.address,
      value: BigInt(42),
    });
    const erc20ApprovalRawSigned = await walletClient.signTransaction(
      erc20Approval
    );

    // const nextBlockNumber = Number(await provider.getBlockNumber()) + 1;

    // We will send the approval transaction to the public mempool as a separate
    // request, as it doesn't contain any MEV.
    const approvalTxPayload = {
      tx: erc20ApprovalRawSigned,
      usePublicMempool: true,
      awaitReceipt: true,
      awaitReceiptTimeoutMs: 20_000,
    };

    const rpcRequest = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "eth_sendPrivateRawTransaction",
      params: [approvalTxPayload],
    });

    console.log("Sending transaction to Echo:", rpcRequest);
    echoClient.send(rpcRequest);

    // create a fake erc20 user swap tx (sending 42 wei to ourselves) for demo purposes
    const erc20UserSwap = await walletClient.prepareTransactionRequest({
      to: account.address,
      value: BigInt(69),
    });
    const erc20UserSwapRawSigned = await walletClient.signTransaction(
      erc20UserSwap
    );

    // Send this swap as a private transaction, skipping the public mempool.
    const privateTxPayload = {
      txs: [erc20UserSwapRawSigned],
      usePublicMempool: false,
      awaitReceipt: true,
      awaitReceiptTimeoutMs: 60_000,
      mevBuilders: ["titan", "rsync", "beaverbuild"],
    };

    const rpcRequest2 = JSON.stringify({
      id: 2,
      jsonrpc: "2.0",
      method: "eth_sendPrivateRawTransaction",
      params: [privateTxPayload],
    });

    console.log("Sending private transaction to Echo:", rpcRequest2);
    echoClient.send(rpcRequest2);
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

telegramBotOperation()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
