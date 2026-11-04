// Stand-in for the app's askpass mode in vitest: same client code, run by plain node (type stripping).
const { requestAnswer } = await import('../../src/main/auth/askpass.ts')
const answer = await requestAnswer(process.env.GITDOCK_ASKPASS_SOCKET, process.env.GITDOCK_ASKPASS_TOKEN, process.argv.at(-1))
if (answer === null) process.exit(1)
process.stdout.write(answer + '\n')
