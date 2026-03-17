import { config } from "dotenv";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactStellarScheme as ExactStellarServerScheme } from "@x402/stellar/exact/server";
import { ExactStellarScheme as ExactStellarFacilitatorScheme } from "@x402/stellar/exact/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import { createEd25519Signer } from "@x402/stellar";

config();

// ── Environment ────────────────────────────────────────────────────────────────

/**
 * The Stellar G-address that receives USDC payments from callers.
 * Can be any funded testnet account (or just an address – it only receives funds).
 */
const stellarAddress = process.env.STELLAR_ADDRESS as string;

/**
 * Private key of the *facilitator* account.
 * This account must hold XLM on testnet so it can pay the Soroban transaction fees
 * (the "fee bump" that wraps the client-signed transaction before submission).
 * Get free testnet XLM from https://laboratory.stellar.org/#account-creator
 */
const facilitatorPrivateKey = process.env.STELLAR_FACILITATOR_PRIVATE_KEY as string;

if (!stellarAddress || !facilitatorPrivateKey) {
  console.error(
    "❌  Missing required environment variables.\n" +
      "    Set STELLAR_ADDRESS and STELLAR_FACILITATOR_PRIVATE_KEY in server/.env",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 4021);
const PRICE = process.env.PRICE ?? "$0.001";
const NETWORK = (process.env.STELLAR_NETWORK ?? "testnet") as "testnet" | "pubnet";
const NETWORK_CAIP2 = `stellar:${NETWORK}` as const;

// ── Facilitator ────────────────────────────────────────────────────────────────

/**
 * A *local* x402 facilitator – no external HTTP call is needed.
 * It verifies and settles Stellar payments in-process.
 *
 * The facilitator signer's account pays the Soroban transaction fee
 * via a fee-bump envelope (areFeesSponsored: true is the default).
 */
const facilitatorSigner = createEd25519Signer(facilitatorPrivateKey, NETWORK_CAIP2);

const facilitator = new x402Facilitator();
facilitator.register(
  [NETWORK_CAIP2],
  new ExactStellarFacilitatorScheme([facilitatorSigner], {
    areFeesSponsored: true, // facilitator wraps tx in a fee-bump and pays fees
  }),
);

// ── Express app ────────────────────────────────────────────────────────────────

const app = express();

/**
 * x402 payment middleware – gates the /joke route.
 *
 * When a client calls GET /joke without payment the middleware returns HTTP 402
 * with a JSON body describing what payment is required (network, price, asset,
 * payTo address). The @x402/fetch client library handles this automatically.
 */
app.use(
  paymentMiddleware(
    {
      "GET /joke": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE,
            network: NETWORK_CAIP2,
            payTo: stellarAddress,
          },
        ],
        description: "A funny joke (costs " + PRICE + " USDC on Stellar " + NETWORK + ")",
        mimeType: "application/json",
      },
    },
    // Pass the local facilitator directly – it implements the FacilitatorClient interface
    new x402ResourceServer(facilitator).register(NETWORK_CAIP2, new ExactStellarServerScheme()),
  ),
);

// ── Protected route ────────────────────────────────────────────────────────────

const jokes = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "Why can't you give Elsa a balloon? Because she'll let it go.",
  "What do you call cheese that isn't yours? Nacho cheese.",
  "I'm reading a book about anti-gravity. It's impossible to put down.",
];

app.get("/joke", (_req, res) => {
  const joke = jokes[Math.floor(Math.random() * jokes.length)];
  res.json({ joke });
});

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀  x402 Stellar server running at http://localhost:${PORT}`);
  console.log(`\n   Network  : ${NETWORK_CAIP2}`);
  console.log(`   Endpoint : GET http://localhost:${PORT}/joke`);
  console.log(`   Price    : ${PRICE} USDC`);
  console.log(`   Pay to   : ${stellarAddress}`);
  console.log(`\n   Facilitator address: ${facilitatorSigner.address}`);
  console.log(
    `\n   ⚠️  Ensure the facilitator account has XLM on ${NETWORK} to sponsor fees.`,
  );
  console.log(`   Testnet faucet: https://laboratory.stellar.org/#account-creator\n`);
});
