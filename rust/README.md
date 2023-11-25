# rust examples

These examples rely on the [Artemis x Chainbound](https://github.com/paradigmxyz/artemis/tree/main/crates/clients/chainbound) library.

## Usage

Make sure you have the following variables set:

```shell
export FIBER_TEST_KEY=<your fiber api key>
export ETHEREUM_TEST_PK=<your private key>
```

To run the examples, simply run the following commands from this directory:

```shell
# uniswap arb example
cargo run --bin uniswap-arb

# telegram bot example
cargo run --bin telegram-bot
```
