/**
 * Call HashedTimelockLog 100 times (1 CID per call) + log to file
 *
 * Run:
 *   truffle exec scripts/hashedtimelocklog_100calls.js --network development
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HashedTimelockLog = artifacts.require("HashedTimelockLog");

const LOG_PATH = path.join(
  __dirname,
  "..",
  "hashedtimelocklog_100calls_log.txt",
);

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  fs.appendFileSync(LOG_PATH, msg + "\n", { encoding: "utf8" });
}

function randomCID32() {
  return web3.utils.randomHex(32); // 32 bytes
}

function sha256Hex(hex0x) {
  const buf = Buffer.from(hex0x.slice(2), "hex");
  return "0x" + crypto.createHash("sha256").update(buf).digest("hex");
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

function extractContractId(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const l of receipt.logs) {
    if (l.args && l.args.contractId) return l.args.contractId;
  }
  return null;
}

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `HashedTimelockLog – 100 single-CID calls @ ${new Date().toISOString()}\n\n`,
      { encoding: "utf8" },
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    log(`Sender:   ${sender}`);
    log(`Receiver: ${receiver}`);

    const instance = await HashedTimelockLog.deployed();
    log(`Contract: ${instance.address}`);

    // BIG buffer to guarantee "future" relative to chain time.
    // (If you previously advanced time, this still holds.)
    const FUTURE_BUFFER_SECONDS = 3600; // 1 hour
    const STAGGER_SECONDS = 5;

    let totalCreateGas = 0;
    let totalVerifyGas = 0;
    let createOk = 0;
    let verifyOk = 0;

    for (let i = 0; i < 100; i++) {
      log(`\n=== CALL ${i + 1}/100 ===`);

      const cid = randomCID32();
      const hashlock = sha256Hex(cid);

      // message is arbitrary payload; stored via messageHash commitment
      const message = web3.utils.randomHex(64);
      const messageHash = web3.utils.keccak256(message);

      // IMPORTANT: derive timelock from chain time immediately before tx
      const now = await chainNow();
      const timelock = now + FUTURE_BUFFER_SECONDS + i * STAGGER_SECONDS;

      log(`chainNow: ${now}`);
      log(`timelock: ${timelock}`);
      log(`CID: ${cid}`);
      log(`hashlock: ${hashlock}`);
      log(`messageHash: ${messageHash}`);

      // ---- CREATE ----
      let createTx;
      try {
        createTx = await instance.newContract(
          receiver,
          hashlock,
          messageHash,
          timelock,
          { from: sender },
        );
      } catch (e) {
        log(`CREATE FAILED: ${e.reason || e.message || e}`);
        continue; // move to next call
      }

      createOk++;
      const createGas = createTx.receipt.gasUsed;
      totalCreateGas += createGas;

      const contractId = extractContractId(createTx.receipt);
      log(`contractId: ${contractId ? contractId.toString() : "NOT_FOUND"}`);
      log(`create gasUsed: ${createGas}`);

      if (!contractId) {
        log(`VERIFY SKIPPED: could not extract contractId from event logs.`);
        continue;
      }

      // ---- VERIFY ----
      try {
        const verifyTx = await instance.verifyLog(contractId, message, {
          from: receiver,
        });
        verifyOk++;
        const verifyGas = verifyTx.receipt.gasUsed;
        totalVerifyGas += verifyGas;
        log(`verify gasUsed: ${verifyGas}`);
      } catch (e) {
        log(`VERIFY FAILED: ${e.reason || e.message || e}`);
      }
    }

    log(`\n=== SUMMARY ===`);
    log(`create ok: ${createOk}/100`);
    log(`verify ok: ${verifyOk}/${createOk}`);
    log(`Total create gas: ${totalCreateGas}`);
    log(
      `Avg create gas: ${createOk ? Math.round(totalCreateGas / createOk) : 0}`,
    );
    log(`Total verify gas: ${totalVerifyGas}`);
    log(
      `Avg verify gas: ${verifyOk ? Math.round(totalVerifyGas / verifyOk) : 0}`,
    );
    log(`\nDone. Log written to: ${LOG_PATH}`);

    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
