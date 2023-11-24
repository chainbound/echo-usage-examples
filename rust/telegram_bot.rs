use std::{str::FromStr, sync::Arc};

use artemis_core::{
    engine::Engine,
    types::{ExecutorMap, Strategy},
};
use chainbound_artemis::{
    Action, BlockBuilder, EchoExecutor, Event, FiberCollector, SendBundleArgs,
    SendPrivateTransactionArgs, StreamType,
};
use ethers::{
    prelude::rand,
    providers::{Middleware, Provider, Ws},
    signers::{LocalWallet, Signer},
    types::{TransactionRequest, U256},
};
use tokio::sync::broadcast;

#[derive(Debug)]
#[allow(unused)]
pub struct MevStrategy<S> {
    tx_signer: S,
    provider: Arc<Provider<Ws>>,
    request_id: u64,
    receipts_rx: broadcast::Receiver<String>,
    can_send: bool, // only for demo purposes
}

#[async_trait::async_trait]
impl Strategy<Event, Action> for MevStrategy<LocalWallet> {
    async fn sync_state(&mut self) -> anyhow::Result<()> {
        // TODO: Implement your initial bot sync logic here
        // (e.g. load pool state, check balances, etc.)

        Ok(())
    }

    async fn process_event(&mut self, event: Event) -> Vec<Action> {
        // For demo purposes, we'll just pick a transaction from the
        // mempool and send a fake backrun to the echo executor.
        // In a real strategy, you'd want to do some checks
        // and build your own transactions to send in a bundle.

        let Event::Transaction(_mempool_tx) = event else {
            // You could have other types of events coming from collectors such as
            // new beacon blocks to update DEX pool reserves or new token listings.
            // For now, we'll just ignore them.

            tracing::warn!("Received unexpected non-transaction event: {:?}", event);
            return vec![];
        };

        if !self.can_send {
            // For demo purposes, we'll only send one bundle.
            // In a real strategy, you'd want to keep track of the
            // bundles you've sent and only send new ones when you
            // receive new transactions from the mempool with the
            // given conditions you're looking for.

            return vec![];
        }
        self.can_send = false;
        tracing::info!("Sending a bundle...");

        let account = self.tx_signer.address();

        // For demo purposes, we'll just send a fake approval and swap, simulating
        // a user of a telegram bot performing actions.
        let fake_erc20_approval = TransactionRequest::new()
            .to(account)
            .from(account)
            .value(42)
            .gas_price(U256::from_dec_str("50000000000").unwrap());

        let fake_erc20_user_swap = TransactionRequest::new()
            .to(account)
            .from(account)
            .value(42)
            .gas_price(U256::from_dec_str("50000000000").unwrap());

        let block_number = self.provider.get_block_number().await.unwrap();
        let next_block = (block_number + 1).as_u64();

        // Send the approval transaction separately as a public
        // transaction propagated quickly through the Fiber Network
        let public_tx = Action::SendPrivateTransaction(
            SendPrivateTransactionArgs::with_tx(fake_erc20_approval)
                .set_request_id(self.request_id)
                .set_await_receipt(true)
                .set_use_public_mempool(true),
        );

        self.request_id += 1;

        // Since the swap can create MEV, send it privately as a bundle
        // directly to builders!
        let bundle = Action::SendBundle(
            SendBundleArgs::with_txs(vec![fake_erc20_user_swap])
                .set_request_id(self.request_id)
                .set_block_number(next_block)
                .set_await_receipt(true)
                .set_await_receipt_timeout_ms(60_000)
                .set_mev_builders(vec![BlockBuilder::Titan, BlockBuilder::Beaverbuild])
                .set_refund_percent(90)
                .set_refund_index(0),
        );

        vec![public_tx, bundle]
    }
}

impl MevStrategy<LocalWallet> {
    /// Spawn a separate task to listen for inclusion receipts
    pub fn listen_for_receipts(&self) {
        let mut receipts = self.receipts_rx.resubscribe();
        tokio::spawn(async move {
            loop {
                let Ok(receipt) = receipts.recv().await else {
                    tracing::error!("Receipt channel failed");
                    continue;
                };

                let Ok(res) = serde_json::from_str::<serde_json::Value>(&receipt) else {
                    tracing::error!("Failed to parse receipt: {:?}", receipt);
                    continue;
                };

                // Here you can do whatever you want with the inclusion receipt!
                // For example, you could update your Prometheus metrics, or send a
                // Telegram message to your phone, or even trigger subsequent transactions.

                tracing::info!("Received bundle inclusion receipt: {:?}", res);
            }
        });
    }
}

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    let _ = tracing_subscriber::fmt::try_init();
    let api_key = std::env::var("FIBER_TEST_KEY")?;
    let private_key = std::env::var("ETHEREUM_TEST_PK")?;

    tracing::info!("Starting Uniswap Arbitrage bot example...");

    // Listen to new pending transactions from Fiber
    let stream_type = StreamType::Transactions;
    let fiber_collector = FiberCollector::new(api_key.clone(), stream_type).await;

    // Create the Echo Executor to send our bundles to the desired block builders.
    let provider = Arc::new(Provider::connect("wss://eth.llamarpc.com").await?);
    let tx_signer = LocalWallet::from_str(&private_key)?;
    let auth_signer = LocalWallet::new(&mut rand::thread_rng());
    let echo_exec =
        EchoExecutor::new(provider.clone(), tx_signer.clone(), auth_signer, api_key).await;

    let receipts_rx = echo_exec.receipts_channel();
    let executor_map = ExecutorMap::new(Box::new(echo_exec), Some);

    // Add these components to the Artemis engine
    let mut engine: Engine<Event, Action> = Engine::default();
    engine.add_collector(Box::new(fiber_collector));
    engine.add_executor(Box::new(executor_map));

    // --- bootstrap your trading strategy here ---
    let strategy = MevStrategy {
        tx_signer,
        provider,
        receipts_rx,
        request_id: 1,
        can_send: true,
    };

    // --- Spawn a task to listen for receipts ---
    strategy.listen_for_receipts();

    // Add your strategy to the engine
    engine.add_strategy(Box::new(strategy));

    // Run the engine
    if let Ok(mut set) = engine.run().await {
        while let Some(res) = set.join_next().await {
            println!("res: {:?}", res);
        }
    }

    Ok(())
}
