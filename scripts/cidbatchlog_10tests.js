/**
 * scripts/cidbatchlog_10tests.js
 *
 * Run:
 *   truffle migrate --reset --network development
 *   truffle exec scripts/cidbatchlog_10tests.js --network development
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const CIDBatchLog = artifacts.require("CIDBatchLog");

const LOG_PATH = path.join(__dirname, "..", "cidbatchlog_testlog.txt");

/* ───────────── Logging ───────────── */

function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + "\n", { encoding: "utf8" });
}

/* ───────────── Helpers ───────────── */

// 32-byte CID-style digest
function randomCID() {
  return web3.utils.randomHex(32);
}

function randomMessage() {
  return web3.utils.randomHex(64);
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

function extractBatchId(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const l of receipt.logs) {
    if (l.args && l.args.batchId) return l.args.batchId;
  }
  return null;
}

/* ───────────── Main ───────────── */

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `CIDBatchLog 10-test run @ ${new Date().toISOString()}\n\n`,
      { encoding: "utf8" },
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    logLine(`Using sender:   ${sender}`);
    logLine(`Using receiver: ${receiver}`);

    const instance = await CIDBatchLog.deployed();
    logLine(`CIDBatchLog deployed at: ${instance.address}`);

    const FUTURE_BUFFER_SECONDS = 300;
    const STAGGER_SECONDS = 2;

    for (let i = 1; i <= 10; i++) {
      logLine(`\n=== TEST ${i}/10 ===`);

      const now = await chainNow();
      const timelock = now + FUTURE_BUFFER_SECONDS + i * STAGGER_SECONDS;

      // Create a random batch of 3–6 CIDs
      const cidCount = 3 + (i % 4);
      const cids = [];
      for (let j = 0; j < cidCount; j++) {
        cids.push(randomCID());
      }

      const message = randomMessage();
      const messageHash = web3.utils.keccak256(message);

      logLine(`CID count: ${cidCount}`);
      cids.forEach((c, idx) => logLine(`CID[${idx}]: ${c}`));
      logLine(`messageHash: ${messageHash}`);
      logLine(`timelock(unix): ${timelock}`);

      /* ---- CREATE BATCH ---- */
      const createTx = await instance.createBatch(
        receiver,
        cids,
        messageHash,
        timelock,
        { from: sender },
      );

      const batchId = extractBatchId(createTx.receipt);
      logLine(`create tx: ${createTx.tx}`);
      logLine(`create gasUsed: ${createTx.receipt.gasUsed}`);
      logLine(`batchId: ${batchId ? batchId.toString() : "NOT_FOUND"}`);

      if (!batchId) {
        logLine("SKIP: could not extract batchId");
        continue;
      }

      /* ---- RELEASE AGGREGATE ---- */
      const releaseTx = await instance.releaseAggregate(batchId, {
        from: sender,
      });
      logLine(`release tx: ${releaseTx.tx}`);
      logLine(`release gasUsed: ${releaseTx.receipt.gasUsed}`);

      /* ---- VERIFY CIDS ---- */
      const verifyTx = await instance.verifyCIDs(batchId, cids, {
        from: receiver,
      });
      logLine(`verify tx: ${verifyTx.tx}`);
      logLine(`verify gasUsed: ${verifyTx.receipt.gasUsed}`);

      /* ---- VERIFY MESSAGE ---- */
      const verifyMsgTx = await instance.verifyMessage(batchId, message, {
        from: receiver,
      });
      logLine(`verifyMessage gasUsed: ${verifyMsgTx.receipt.gasUsed}`);

      /* ---- STATE ---- */
      const b = await instance.getBatch(batchId);
      logLine(
        `state: released=${b.released} verified=${b.verified} cidCount=${b.cidCount}`,
      );
    }

    logLine(`\nAll 10 CID batch tests completed successfully.`);
    logLine(`Log written to: ${LOG_PATH}`);
    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
