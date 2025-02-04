use std::{str::FromStr, time::Duration};

use alloy::{
    network::{EthereumWallet, TransactionBuilder},
    primitives::U256,
    providers::{Provider, ProviderBuilder, SendableTx},
    rpc::{
        json_rpc::{Request as JsonRpcRequest, Response as JsonRpcResponse},
        types::TransactionRequest,
    },
    signers::local::PrivateKeySigner,
    transports::http::reqwest::{header::HeaderMap, Client, Url},
};
use echo_types::{SendBundleArgs, SendBundleResponse, ECHO_HTTP_RPC_URL};
use eyre::Context;

mod echo_types;

#[tokio::main]
async fn main() -> eyre::Result<()> {
    let _ = tracing_subscriber::fmt::try_init();
    let api_key = std::env::var("FIBER_TEST_KEY").wrap_err("FIBER_TEST_KEY not set")?;
    let private_key = std::env::var("ETHEREUM_TEST_PK").wrap_err("ETHEREUM_TEST_PK not set")?;

    // Create a signer from the private key
    let signer = PrivateKeySigner::from_str(&private_key)?;
    let wallet = EthereumWallet::from(signer.clone());

    // Use an ethereum node to fill transaction data such as nonce, gas price, etc.
    let ethereum_node = Url::parse("https://eth.llamarpc.com")?;
    let ethereum_provider = ProviderBuilder::new().wallet(wallet).on_http(ethereum_node);

    // Create a client to send requests to the echo api
    let mut headers = HeaderMap::new();
    headers.insert("Content-Type", "application/json".parse()?);
    headers.insert("X-Api-Key", api_key.parse().wrap_err("Invalid API key")?);

    let http_client = Client::builder()
        .timeout(Duration::from_secs(300))
        .default_headers(headers)
        .build()?;

    // start by creating a new transaction and signing it
    let tx = TransactionRequest::default()
        .with_to(signer.address()) // self-transfer
        .with_value(U256::from(100)); // 100 wei

    // fill the transaction with data from the ethereum node
    let signed_tx = match ethereum_provider.fill(tx).await? {
        SendableTx::Envelope(envelope) => envelope,
        _ => eyre::bail!("Failed to fill transaction"),
    };

    // Get the current block number, to target the next block
    let block_number = ethereum_provider.get_block_number().await?;
    let target_block = block_number + 1;

    // Build a new bundle. See all the available options in the `SendBundleArgs` struct.
    let mut bundle = SendBundleArgs::with_txs(vec![signed_tx]);
    bundle.set_block_number(target_block);
    bundle.set_await_receipt(true);

    let rpc_request = JsonRpcRequest::new("eth_sendBundle", 1.into(), bundle);

    println!(
        "Sending bundle to Echo: {}",
        serde_json::to_string(&rpc_request)?
    );

    // Send the bundle to the echo api
    let response = http_client
        .post(ECHO_HTTP_RPC_URL)
        .json(&rpc_request)
        .send()
        .await?;

    // Print the response
    println!(
        "Echo response: {:?}",
        response
            .json::<JsonRpcResponse<SendBundleResponse>>()
            .await?
    );

    Ok(())
}
