import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys MockUSDT and HSKFaucet to the current network.
 * Fund the HSKFaucet after deployment:
 *   cast send <HSKFaucetAddr> --value 10ether --private-key $DEPLOYER_PRIVATE_KEY --rpc-url https://testnet.hsk.xyz
 *
 * Usage:
 *   npx hardhat run scripts/deployFaucets.ts --network hashkeyTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Deploying faucet contracts on ${networkName} (chain ${chainId})`);
  console.log("Deployer:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "HSK"
  );

  // 1. Deploy MockUSDT
  console.log("\n1. Deploying MockUSDT...");
  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const mockUsdt = await MockUSDT.deploy(deployer.address);
  await mockUsdt.waitForDeployment();
  const mockUsdtAddr = await mockUsdt.getAddress();
  console.log("   MockUSDT:", mockUsdtAddr);

  // 2. Deploy HSKFaucet
  console.log("2. Deploying HSKFaucet...");
  const HSKFaucet = await ethers.getContractFactory("HSKFaucet");
  const hskFaucet = await HSKFaucet.deploy(deployer.address);
  await hskFaucet.waitForDeployment();
  const hskFaucetAddr = await hskFaucet.getAddress();
  console.log("   HSKFaucet:", hskFaucetAddr);

  // 3. Fund the HSKFaucet with 5 HSK
  console.log("3. Funding HSKFaucet with 5 HSK...");
  const fundTx = await deployer.sendTransaction({
    to: hskFaucetAddr,
    value: ethers.parseEther("5"),
  });
  await fundTx.wait();
  console.log("   Funded: 5 HSK sent to HSKFaucet");

  // 4. Update deployments JSON
  const deploymentsPath = path.join(__dirname, `../deployments/${networkName}.json`);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(deploymentsPath)) {
    existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  }
  const contracts = (existing.contracts as Record<string, string>) || {};
  contracts.MockUSDT = mockUsdtAddr;
  contracts.HSKFaucet = hskFaucetAddr;
  existing.contracts = contracts;
  fs.writeFileSync(deploymentsPath, JSON.stringify(existing, null, 2));
  console.log(`\nDeployments updated in deployments/${networkName}.json`);

  console.log("\n=== Faucet Deployment Summary ===");
  console.log("MockUSDT:  ", mockUsdtAddr);
  console.log("HSKFaucet: ", hskFaucetAddr);
  console.log("\nAdd to .env / Vercel env vars:");
  console.log(`NEXT_PUBLIC_USDT_ADDRESS=${mockUsdtAddr}`);
  console.log(`NEXT_PUBLIC_HSK_FAUCET_ADDRESS=${hskFaucetAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
