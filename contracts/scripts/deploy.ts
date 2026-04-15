import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address))
  );

  const feeRecipient =
    process.env.FEE_RECIPIENT_ADDRESS || deployer.address;

  // 1. Deploy NonceRegistry
  console.log("\n1. Deploying NonceRegistry...");
  const NonceRegistry = await ethers.getContractFactory("NonceRegistry");
  const nonceRegistry = await NonceRegistry.deploy();
  await nonceRegistry.waitForDeployment();
  const nonceRegistryAddr = await nonceRegistry.getAddress();
  console.log("   NonceRegistry:", nonceRegistryAddr);

  // 2. Deploy MerchantRegistry
  console.log("2. Deploying MerchantRegistry...");
  const MerchantRegistry = await ethers.getContractFactory("MerchantRegistry");
  const merchantRegistry = await MerchantRegistry.deploy();
  await merchantRegistry.waitForDeployment();
  const merchantRegistryAddr = await merchantRegistry.getAddress();
  console.log("   MerchantRegistry:", merchantRegistryAddr);

  // 3. Deploy HSPAdapter
  console.log("3. Deploying HSPAdapter...");
  const HSPAdapter = await ethers.getContractFactory("HSPAdapter");
  const hspAdapter = await HSPAdapter.deploy();
  await hspAdapter.waitForDeployment();
  const hspAdapterAddr = await hspAdapter.getAddress();
  console.log("   HSPAdapter:", hspAdapterAddr);

  // 4. Deploy HashPointEscrow
  console.log("4. Deploying HashPointEscrow...");
  const HashPointEscrow = await ethers.getContractFactory("HashPointEscrow");
  const escrow = await HashPointEscrow.deploy(
    nonceRegistryAddr,
    merchantRegistryAddr,
    hspAdapterAddr,
    feeRecipient,
    10 // 0.1% fee (10 bps)
  );
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("   HashPointEscrow:", escrowAddr);

  // 5. Grant ESCROW_ROLE on HSPAdapter
  console.log("5. Granting ESCROW_ROLE on HSPAdapter...");
  const ESCROW_ROLE = await hspAdapter.ESCROW_ROLE();
  const tx = await hspAdapter.grantRole(ESCROW_ROLE, escrowAddr);
  await tx.wait();
  console.log("   ESCROW_ROLE granted to escrow");

  // 6. Set escrow on MerchantRegistry
  console.log("6. Setting escrow on MerchantRegistry...");
  const tx2 = await merchantRegistry.setEscrow(escrowAddr);
  await tx2.wait();
  console.log("   Escrow set on MerchantRegistry");

  // 7. Deploy MockUSDC (test networks only)
  let mockUsdcAddr = "";
  const networkName = network.name;
  if (networkName !== "hashkeyMainnet") {
    console.log("7. Deploying MockUSDC (testnet only)...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy(deployer.address);
    await mockUsdc.waitForDeployment();
    mockUsdcAddr = await mockUsdc.getAddress();
    console.log("   MockUSDC:", mockUsdcAddr);
  }

  // 8. Write deployed addresses to deployments/{network}.json
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployments: Record<string, unknown> = {
    network: networkName,
    chainId,
    deployedAt: new Date().toISOString(),
    contracts: {
      NonceRegistry: nonceRegistryAddr,
      MerchantRegistry: merchantRegistryAddr,
      HSPAdapter: hspAdapterAddr,
      HashPointEscrow: escrowAddr,
      ...(mockUsdcAddr ? { MockUSDC: mockUsdcAddr } : {}),
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(deploymentsDir, `${networkName}.json`),
    JSON.stringify(deployments, null, 2)
  );

  console.log(`\nDeployments written to deployments/${networkName}.json`);
  console.log("\n=== Deployment Summary ===");
  console.log("NonceRegistry:    ", nonceRegistryAddr);
  console.log("MerchantRegistry: ", merchantRegistryAddr);
  console.log("HSPAdapter:       ", hspAdapterAddr);
  console.log("HashPointEscrow:  ", escrowAddr);
  if (mockUsdcAddr) console.log("MockUSDC:         ", mockUsdcAddr);
  console.log("\nUpdate SDK HASHPOINT_DOMAIN.verifyingContract with:", escrowAddr);
  if (mockUsdcAddr) console.log("Set NEXT_PUBLIC_USDC_ADDRESS =", mockUsdcAddr);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
