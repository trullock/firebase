export function environment()
{
	let fnEmulator = process.env.FUNCTIONS_EMULATOR;
	return fnEmulator === true || fnEmulator === 'true' ? 'dev' : 'prod'
}