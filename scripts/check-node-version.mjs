const requiredMajor = 22;
const actualMajor = Number.parseInt(
  process.versions.node.split(".")[0] ?? "0",
  10,
);

if (actualMajor < requiredMajor) {
  console.error(
    `DSTAR requires Node.js ${requiredMajor}+; found ${process.versions.node}.`,
  );
  process.exitCode = 1;
} else {
  console.log(`Node.js ${process.versions.node} satisfies the DSTAR baseline.`);
}
