export function environment()
{
	let fnEmulator = process.env.FUNCTIONS_EMULATOR;
	return fnEmulator === true || fnEmulator === 'true' ? 'dev' : 'prod'
}


let nowFn = () => new Date();
export function setNowFn(fn)
{
	nowFn = fn;
}
export function getNow()
{
	return nowFn();
}