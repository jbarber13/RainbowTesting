/**
 * listSwapTargets.ts
 *
 * Queries a RainbowRouter deployment for SwapTargetAdded and SwapTargetRemoved events
 * and prints the current swap targets as well as any that were removed.
 *
 * Usage: npx hardhat run scripts/listSwapTargets.ts --network op
 */

import hre from "hardhat";
import { RainbowRouter__factory } from "../typechain-types";
import { getNetworkConfig } from "../util/networkConfig";
import { TypedEventLog } from "../typechain-types/common";
import { SwapTargetAddedEvent, SwapTargetRemovedEvent } from "../typechain-types/contracts/RainbowRouter";

const BLOCK_CHUNK_SIZE = 10000; // Max 10000 blocks on free tier
const DELAY_MS = 1000; // Delay between chunks to avoid rate limiting

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryEventsInChunks<T extends TypedEventLog<any>>(
  contract: any,
  filter: any,
  fromBlock: number,
  toBlock: number
): Promise<T[]> {
  const allEvents: T[] = [];
  const totalChunks = Math.ceil((toBlock - fromBlock) / BLOCK_CHUNK_SIZE);
  let chunkNum = 0;

  for (let start = fromBlock; start <= toBlock; start += BLOCK_CHUNK_SIZE) {
    const end = Math.min(start + BLOCK_CHUNK_SIZE - 1, toBlock);
    chunkNum++;

    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        const events = await contract.queryFilter(filter, start, end);
        allEvents.push(...events);

        if (events.length > 0) {
          process.stdout.write(`  Found ${events.length} events in chunk ${chunkNum}/${totalChunks}\n`);
        }
        break; // Success - exit retry loop
      } catch (error: any) {
        retries++;
        const isRetryable = error.message.includes('timeout') ||
                           error.message.includes('rate') ||
                           error.message.includes('Too Many') ||
                           error.message.includes('429') ||
                           error.message.includes('GRPC') ||
                           error.message.includes('cancellation');

        if (isRetryable && retries < maxRetries) {
          const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff: 2s, 4s, 8s, 16s
          console.log(`  Error (${error.message.slice(0, 30)}...), waiting ${waitTime/1000}s (retry ${retries}/${maxRetries})...`);
          await sleep(waitTime);
        } else {
          throw error;
        }
      }
    }

    if (start + BLOCK_CHUNK_SIZE <= toBlock) {
      await sleep(DELAY_MS);
    }
  }

  return allEvents;
}

async function main() {
  const networkName = hre.network.name;
  const config = getNetworkConfig(networkName);

  console.log(`Querying SwapTargets for ${config.chainName} (${config.rainbowRouterAddress})...`);

  const Rainbow = RainbowRouter__factory.connect(
    config.rainbowRouterAddress,
    hre.ethers.provider
  );

  const latestBlock = await hre.ethers.provider.getBlockNumber();

  // Use deployment block from config
  const deploymentBlock = config.deploymentBlock;

  // Scan from deployment to latest
  const startBlock = deploymentBlock;
  const endBlock = latestBlock;
  const totalBlocks = endBlock - startBlock;

  console.log(`Scanning blocks ${startBlock} to ${endBlock} (~${Math.round(totalBlocks/1000)}K blocks)...\n`);

  // Query SwapTargetAdded events
  console.log(`Querying SwapTargetAdded events...`);
  const addedEvents = await queryEventsInChunks<TypedEventLog<SwapTargetAddedEvent.Event>>(
    Rainbow,
    Rainbow.filters.SwapTargetAdded(),
    startBlock,
    endBlock
  );

  // Query SwapTargetRemoved events
  console.log(`\nQuerying SwapTargetRemoved events...`);
  const removedEvents = await queryEventsInChunks<TypedEventLog<SwapTargetRemovedEvent.Event>>(
    Rainbow,
    Rainbow.filters.SwapTargetRemoved(),
    startBlock,
    endBlock
  );

  // Build set of all targets that were ever added
  const allAdded = new Set<string>();
  for (const event of addedEvents) {
    allAdded.add(event.args.target.toLowerCase());
  }

  // Build set of removed targets
  const removed = new Set<string>();
  for (const event of removedEvents) {
    removed.add(event.args.target.toLowerCase());
  }

  // Current targets = added - removed
  const current = new Set<string>();
  for (const target of allAdded) {
    if (!removed.has(target)) {
      current.add(target);
    }
  }

  // Print current targets
  console.log(`\n✅ Current Swap Targets (${current.size}):`);
  for (const target of [...current].sort()) {
    console.log(`  ${target}`);
  }

  // Print removed targets
  if (removed.size > 0) {
    console.log(`\n❌ Removed Swap Targets (${removed.size}):`);
    for (const target of [...removed].sort()) {
      console.log(`  ${target}`);
    }
  }

  console.log(`\nTotal events: ${addedEvents.length} added, ${removedEvents.length} removed`);
}

main().catch(console.error);
