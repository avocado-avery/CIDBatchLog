/**
 * scripts/hashedtimelock_100tests.js
 *
 * Runs 100 HTLC create + withdraw cycles and logs results to a file.
 *
 * Run:
 *   truffle migrate --reset --network development
 *   truffle exec scripts/hashedtimelock_100tests.js --network development
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HashedTimelock = artifacts.require("HashedTimelock");

const LOG_PATH = path.join(__dirname, "..", "hashedtimelock_100tests_log.txt");

function logLine(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + "\n", { encoding: "utf8" });
}

async function chainNow() {
  const b = await web3.eth.getBlock("latest");
  return Number(b.timestamp);
}

// 32-byte preimage, matches the contract signature withdraw(bytes32 _preimage)
function randomPreimage32() {
  // returns 0x + 64 hex
  return web3.utils.randomHex(32);
}

// contract checks: hashlock == sha256(abi.encodePacked(_preimage))
// For bytes32, abi.encodePacked(x) is exactly 32 bytes, so hash raw 32 bytes
function sha256Bytes32(hex0x) {
  const buf = Buffer.from(hex0x.slice(2), "hex"); // 32 bytes
  const digestHex = crypto.createHash("sha256").update(buf).digest("hex");
  return "0x" + digestHex; // 32-byte hashlock
}

function extractContractIdFromReceipt(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const l of receipt.logs) {
    if (l.args && l.args.contractId) return l.args.contractId;
    if (l.args && l.args.contractID) return l.args.contractID;
  }
  return null;
}

module.exports = async function (callback) {
  try {
    fs.writeFileSync(
      LOG_PATH,
      `HashedTimelock 100-test run @ ${new Date().toISOString()}\n\n`,
      { encoding: "utf8" },
    );

    const accounts = await web3.eth.getAccounts();
    const sender = accounts[0];
    const receiver = accounts[1];

    logLine(`Sender:   ${sender}`);
    logLine(`Receiver: ${receiver}`);

    const instance = await HashedTimelock.deployed();
    logLine(`Contract: ${instance.address}`);

    const valueWei = web3.utils.toBN("300000"); // same as your earlier runs

    // Timelock: always re-read chain time so it never goes stale
    const FUTURE_BUFFER_SECONDS = 300; // 5 minutes
    const STAGGER_SECONDS = 2;

    let createOk = 0;
    let withdrawOk = 0;
    let totalCreateGas = web3.utils.toBN("0");
    let totalWithdrawGas = web3.utils.toBN("0");

    for (let i = 1; i <= 100; i++) {
      logLine(`\n=== TEST ${i}/100 ===`);

      const now = await chainNow();
      const timelock = now + FUTURE_BUFFER_SECONDS + i * STAGGER_SECONDS;

      const preimage32 = randomPreimage32(); // bytes32
      const hashlock = sha256Bytes32(preimage32); // bytes32

      logLine(`preimage32: ${preimage32}`);
      logLine(`hashlock(sha256(preimage32)): ${hashlock}`);
      logLine(`timelock(unix): ${timelock} (chainNow=${now})`);
      logLine(`value: ${valueWei.toString()} wei`);

      // CREATE
      let createTx;
      try {
        createTx = await instance.newContract(receiver, hashlock, timelock, {
          from: sender,
          value: valueWei.toString(),
        });
        createOk++;
        totalCreateGas = totalCreateGas.add(
          web3.utils.toBN(createTx.receipt.gasUsed),
        );
        logLine(`create tx: ${createTx.tx}`);
        logLine(`create gasUsed: ${createTx.receipt.gasUsed}`);
      } catch (e) {
        logLine(`CREATE FAILED (test ${i}): ${e.reason || e.message || e}`);
        continue;
      }

      const contractId = extractContractIdFromReceipt(createTx.receipt);
      logLine(
        `contractId: ${contractId ? contractId.toString() : "NOT_FOUND"}`,
      );

      if (!contractId) {
        logLine(
          `WITHDRAW SKIPPED: could not extract contractId from event logs.`,
        );
        continue;
      }

      // WITHDRAW (receiver must call, and must be before timelock)
      try {
        const withdrawTx = await instance.withdraw(contractId, preimage32, {
          from: receiver,
        });
        withdrawOk++;
        totalWithdrawGas = totalWithdrawGas.add(
          web3.utils.toBN(withdrawTx.receipt.gasUsed),
        );
        logLine(`withdraw tx: ${withdrawTx.tx}`);
        logLine(`withdraw gasUsed: ${withdrawTx.receipt.gasUsed}`);
        logLine(`WITHDRAW SUCCESS`);
      } catch (e) {
        logLine(`WITHDRAW FAILED (test ${i}): ${e.reason || e.message || e}`);

        // Helpful debug readback
        try {
          const c = await instance.getContract(contractId);
          logLine(
            `DEBUG getContract: sender=${c[0]} receiver=${c[1]} amount=${c[2].toString()} hashlock=${c[3]} timelock=${c[4].toString()} withdrawn=${c[5]} refunded=${c[6]} preimage=${c[7]}`,
          );
          logLine(`DEBUG local hashlock=${hashlock}`);
        } catch (e2) {
          logLine(`DEBUG getContract failed: ${e2.reason || e2.message || e2}`);
        }
      }
    }

    // Summary
    const avgCreate = createOk
      ? totalCreateGas.div(web3.utils.toBN(createOk)).toString()
      : "0";
    const avgWithdraw = withdrawOk
      ? totalWithdrawGas.div(web3.utils.toBN(withdrawOk)).toString()
      : "0";

    logLine(`\n=== SUMMARY ===`);
    logLine(`create ok: ${createOk}/100`);
    logLine(`withdraw ok: ${withdrawOk}/100`);
    logLine(`Total create gas: ${totalCreateGas.toString()}`);
    logLine(`Avg create gas: ${avgCreate}`);
    logLine(`Total withdraw gas: ${totalWithdrawGas.toString()}`);
    logLine(`Avg withdraw gas: ${avgWithdraw}`);
    logLine(`Log written to: ${LOG_PATH}`);

    callback();
  } catch (err) {
    console.error(err);
    callback(err);
  }
};
