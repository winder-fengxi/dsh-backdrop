/**
 * Refuse every publish that starts in the working tree.
 *
 * The repository is the development copy — it is what the local DSH profile links
 * against, and it may contain uncommitted work. Publishing from here is the mistake
 * this guard exists to prevent, so it always fails with the sanctioned path instead.
 *
 * Hooked from `prepublishOnly`; `"private": true` in the manifest is the second lock.
 *
 * @module dsh-backdrop/tools/refuse-direct-publish
 */

console.error(`
Refusing to publish from the working tree.

  This directory is the development copy (and is "private": true on purpose).
  Publish the staged, commit-verified copy instead:

      npm run pack:publish
      npm publish .publish --access public
`);

process.exit(1);
