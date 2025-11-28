/**
 * listSwapTargets.ts
 *
 * Queries a RainbowRouter deployment for SwapTargetAdded events
 * and prints all swap targets that have been added.
 *
 * Usage: npx hardhat run scripts/listSwapTargets.ts --network op
 *
 * Optional: Set CHECK_REMOVED=true to also query SwapTargetRemoved events
 */

import hre from "hardhat";
import { RainbowRouter__factory } from "../typechain-types";
import { getNetworkConfig } from "../util/networkConfig";
import { TypedEventLog } from "../typechain-types/common";
import { SwapTargetAddedEvent, SwapTargetRemovedEvent } from "../typechain-types/contracts/RainbowRouter";

const BLOCK_CHUNK_SIZE = 500; // Some RPCs limit to 500 blocks max
const DELAY_MS = 300; // Delay between chunks to avoid rate limiting
const CHECK_REMOVED = false; // Set to true to also check SwapTargetRemoved events

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
        const isRateLimit = error.message.includes('timeout') ||
                           error.message.includes('rate') ||
                           error.message.includes('Too Many') ||
                           error.message.includes('429');

        if (isRateLimit && retries < maxRetries) {
          const waitTime = Math.pow(2, retries) * 1000; // Exponential backoff: 2s, 4s, 8s, 16s
          console.log(`  Rate limited, waiting ${waitTime/1000}s (retry ${retries}/${maxRetries})...`);
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

  // Build set of targets
  const targets = new Set<string>();

  for (const event of addedEvents) {
    targets.add(event.args.target.toLowerCase());
  }

  // Optionally check for removed targets
  let removedCount = 0;
  if (CHECK_REMOVED) {
    console.log(`\nQuerying SwapTargetRemoved events...`);
    const removedEvents = await queryEventsInChunks<TypedEventLog<SwapTargetRemovedEvent.Event>>(
      Rainbow,
      Rainbow.filters.SwapTargetRemoved(),
      startBlock,
      latestBlock
    );

    for (const event of removedEvents) {
      targets.delete(event.args.target.toLowerCase());
    }
    removedCount = removedEvents.length;
  }

  // Print results
  console.log(`\nSwap Targets (${targets.size}):`);
  for (const target of [...targets].sort()) {
    console.log(`  ${target}`);
  }

  console.log(`\nTotal events: ${addedEvents.length} added${CHECK_REMOVED ? `, ${removedCount} removed` : ''}`);
}

main().catch(console.error);
