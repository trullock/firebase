// Lists the folders of the packages whose version is newer than the one on npm, one per line
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

async function latestVersion(name)
{
	let response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`);
	if(response.status == 404)
		return null;
	if(!response.ok)
		throw new Error(`npm returned ${response.status} for ${name}`);

	return (await response.json())['dist-tags'].latest;
}

function isNewer(version, than)
{
	let [a, b] = [version, than].map(v => v.split('.').map(Number));
	if([...a, ...b].some(Number.isNaN))
		throw new Error(`Can't compare ${version} with ${than}: only x.y.z versions are published automatically`);

	let i = a.findIndex((n, i) => n != b[i]);
	return i != -1 && a[i] > b[i];
}

let files = execFileSync('git', ['ls-files', '*/package.json'], { encoding: 'utf8' }).split('\n');

for(let file of files.filter(f => /^[^/]+\/package\.json$/.test(f)))
{
	let { name, version, private: isPrivate } = JSON.parse(fs.readFileSync(file, 'utf8'));
	if(isPrivate || !name?.startsWith('@trullock/'))
		continue;

	let latest = await latestVersion(name);
	if(!latest)
		console.error(`${name} isn't on npm: publish its first version by hand`);
	else if(isNewer(version, latest))
		console.log(file.split('/')[0]);
}
