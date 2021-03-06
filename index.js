const getPixels = require('get-pixels')
const color = require('color')
const chalk = require('chalk')
const chromafi = require('chromafi')
const deepmerge = require('deepmerge')

const defaultOpts = require('./default-opts.js')

const style = {
	title: chalk.yellow.underline,
	pass: chalk.bgGreen.black.bold,
	fail: chalk.bgRedBright.black.bold
}

const grad = ' ░▒▓█'

const bMap = {
	H___: '▘',
	_S__: '▝',
	__L_: '▖',
	___A: '▗',
	HS__: '▀',
	HSL_: '▛',
	HSLA: '█',
	_SL_: '▞',
	_SLA: '▟',
	__LA: '▄',
	H__A: '▚',
	H_L_: '▌',
	_S_A: '▐',
	H_LA: '▙',
	HS_A: '▜'
}

const loadPixels = path => new Promise((resolve, reject) => {
	getPixels(path, (err, pixels) => {
		if (err) {
			return reject(err)
		}
		resolve(pixels)
	})
})

const stat = (img, coords) => {
	const {x1, y1, x2, y2, w, h} = coords

	const width = img.shape[0]

	const channelSum = {
		r: 0,
		b: 0,
		g: 0,
		a: 0
	}

	const pixelCount = w * h

	for (let y = y1; y < y2; y++) {
		for (let x = x1; x < x2; x++) {
			const idx = ((width * y) + x) << 2
			channelSum.r += img.data[idx]
			channelSum.g += img.data[idx + 1]
			channelSum.b += img.data[idx + 2]
			channelSum.a += img.data[idx + 3]
		}
	}

	const stat = {
		r: (channelSum.r / pixelCount) / 4,
		b: (channelSum.g / pixelCount) / 4,
		g: (channelSum.b / pixelCount) / 4,
		a: (channelSum.a / pixelCount) / 4
	}

	const average = color({
		r: stat.r,
		g: stat.g,
		b: stat.b
	}).hsl()

	stat.hue = average.color[0]
	stat.sat = average.color[1]
	stat.lum = average.color[2]

	return stat
}

const makeGrid = (width, height, opts) => {
	// The sub-divided width/height
	const w = width / opts.grid.columns
	const h = height / opts.grid.rows

	const size = opts.grid.columns * opts.grid.rows
	const grid = new Array(size).fill().map((e, idx) => {
		const x = idx % opts.grid.columns
		const y = (idx - x) / opts.grid.columns

		// Grid location
		const l = {x, y}

		const x1 = x * w
		const y1 = y * h

		// Window coords
		const c = {
			x1: Math.floor(x1),
			y1: Math.floor(y1),
			x2: Math.floor(x1 + w),
			y2: Math.floor(y1 + h),
			w: Math.floor(w),
			h: Math.floor(h)
		}

		return {l, c}
	})

	return grid
}

const statGridSquares = (img, grid) =>
	grid.map(square => Object.assign(square,
		{stat: stat(img, square.c)}
	))

const log = msg => {
	// eslint-disable-next-line no-console
	console.log(msg || '')
}

const pad = (str, opts, columns) =>
	str.padEnd(columns || opts.grid.columns, ' ')

const logTitle = (str, opts) => {
	if (opts.display.titles) {
		log(style.title(pad(str, opts)) + '\n')
	}
}

const generateScorecard = (channelDiff, opts) => {
	let scorecard = ''

	for (let y = 0; y < opts.grid.rows; y++) {
		for (let x = 0; x < opts.grid.columns; x++) {
			const n = (y * (opts.grid.columns)) + x

			let b = ''
			b += channelDiff.hue[n] ? 'H' : '_'
			b += channelDiff.sat[n] ? 'S' : '_'
			b += channelDiff.lum[n] ? 'L' : '_'
			b += channelDiff.alp[n] ? 'A' : '_'
			const bChar = bMap[b] || ''

			if (bChar) {
				scorecard += chalk.bgRedBright.bold.black(bChar)
			} else {
				scorecard += chalk.bgGreen(' ')
			}
		}
		scorecard += '\n'
	}

	return scorecard
}

const outputScorecard = (scorecard, opts) => {
	log()
	logTitle('Scorecard', opts)
	log(scorecard)
}

const imagesDidFuzzyMatch = maxDiff => {
	const pass = (
		maxDiff.hue +
		maxDiff.sat +
		maxDiff.lum +
		maxDiff.alp
	) === 0
	return pass
}

const outputResult = (pass, maxDiff) => {
	const vals = `diff = {hue: ${maxDiff.hue}, sat: ${maxDiff.sat}, lum: ${maxDiff.lum}, alp: ${maxDiff.alp}}`
	const obj = chromafi(vals, {
		lang: 'javascript',
		lineNumbers: 0
	})

	if (pass) {
		log(style.pass(' PASS ') + obj)
	} else {
		log(style.fail(' FAIL ') + obj)
	}
}

const outputDetails = (pass, maxDiff, opts) => {
	const title = 'Values'
	logTitle(title, opts)

	const chromafiOpts = {
		lineNumbers: false,
		codePad: 0
	}

	log(chalk.magenta('You expected the tolerance to be:'))
	log()
	log(chromafi(opts.tolerance, chromafiOpts))

	log(chalk.magenta('The actual channel difference was:'))
	log(chalk.gray.italic.underline('(Use these values in `opts.tolerance` to make the test pass.)'))
	log()

	const toleranceDiff = {
		hue: maxDiff.hue,
		sat: maxDiff.sat,
		lum: maxDiff.lum,
		alp: maxDiff.alp
	}

	log(chromafi({toleranceDiff}, chromafiOpts))
	log(chalk.grey.italic(`-h ${maxDiff.hue} -s ${maxDiff.sat} -l ${maxDiff.lum} -a ${maxDiff.alp}`))
	return pass
}

const outputVisualDiff = (visualDiff, opts) => {
	logTitle('Visual Diff', opts)
	if (opts.display.titles) {
		log(chalk.grey.italic('(Normalized to tolerance)\n'))
	}

	let termOutput = ''
	while (visualDiff.length > 0) {
		const row = visualDiff.splice(0, opts.grid.columns)
		row.forEach(square => {
			termOutput += square.col(square.char)
		})
		termOutput += '\n'
	}
	log(termOutput)
}

// eslint-disable-next-line max-params
const imageToTerminal = (title, img, columns, grad, opts) => {
	logTitle(title, opts)

	const imgWidth = img.shape[0]
	const imgHeight = img.shape[1]
	const u = 1 / columns * imgWidth
	let termOutput = ''

	for (let y = 0; y < imgHeight; y += u) {
		for (let x = 0; x < imgWidth; x += u) {
			const idx = ((imgWidth * parseInt(y, 10)) +
				parseInt(x, 10)) << 2

			if (idx + 4 <= img.data.length) {
				const r = img.data[idx]
				const g = img.data[idx + 1]
				const b = img.data[idx + 2]
				const l = color({r, g, b}).hsl().color[2]
				const d = chalk.bgRgb(r, g, b).rgb(r, g, b)
				const cIdx = parseInt(((grad.length - 1) / 100) * l, 10)
				const c = grad[cIdx]
				termOutput += d(c)
			}
		}
		termOutput += '\n'
	}

	log(termOutput)
}

const fuzzyMatch = async (img1, img2, opts) => {
	const image1 = await loadPixels(img1)
	const image2 = await loadPixels(img2)

	const [w1, h1] = image1.shape
	const [w2, h2] = image2.shape

	const grid1 = makeGrid(w1, h1, opts)
	const grid2 = makeGrid(w2, h2, opts)

	const size = opts.grid.columns * opts.grid.rows

	const visualDiff = new Array(size).fill(0)
	const channelDiff = {
		hue: new Array(size).fill(0),
		sat: new Array(size).fill(0),
		lum: new Array(size).fill(0),
		alp: new Array(size).fill(0)
	}

	const maxDiff = {
		hue: 0,
		sat: 0,
		lum: 0,
		alp: 0
	}

	const gridStat1 = statGridSquares(image1, grid1)
	const gridStat2 = statGridSquares(image2, grid2)

	const setAbsoluteDiff = (channel, s1, s2, idx) => {
		const aDiff = Math.abs(s1[channel] - s2[channel])
		if (aDiff > opts.tolerance[channel]) {
			channelDiff[channel][idx] += 1
			if (aDiff > maxDiff[channel]) {
				maxDiff[channel] = aDiff
			}
		}
	}

	gridStat1.forEach((square, idx) => {
		const s1 = square.stat
		const s2 = gridStat2[idx].stat

		// Absolute Diff - channel tolerance threshold
		setAbsoluteDiff('hue', s1, s2, idx)
		setAbsoluteDiff('sat', s1, s2, idx)
		setAbsoluteDiff('lum', s1, s2, idx)
		setAbsoluteDiff('alp', s1, s2, idx)

		// Signed Diff - signed values gen difference img
		const hueDiff = s1.hue - s2.hue
		const satDiff = s1.sat - s2.sat
		const lumDiff = s1.lum - s2.lum

		const h = parseInt((360 / maxDiff.hue) * hueDiff, 10) || 0
		const s = parseInt((100 / maxDiff.sat) * satDiff, 10) || 0
		const l = parseInt((100 / maxDiff.lum) * lumDiff, 10) || 0

		const diffColor = color({h, s, l})
			.rgb().color.map(c => parseInt(c, 10))

		const charIndex = parseInt(((grad.length - 1) / 100) * l, 10)

		visualDiff[idx] = {
			// Use foreground and background colors to hide
			// the luninance characters in most situations
			col: chalk.bgRgb(...diffColor).rgb(...diffColor),

			// Provide luminane characters for terminals that
			// may not have good (or any) color support
			char: grad[charIndex] || ' '
		}
	})

	const passed = imagesDidFuzzyMatch(maxDiff)
	const scorecard = generateScorecard(channelDiff, opts)

	if (opts.display.result) {
		outputResult(passed, maxDiff, opts)
	}
	if (opts.display.details) {
		outputDetails(passed, maxDiff, opts)
	}
	if (opts.display.scorecard) {
		outputScorecard(scorecard)
	}
	if (opts.display.visualDiff) {
		outputVisualDiff(visualDiff, opts)
	}

	if (opts.display.images) {
		let columns
		if (typeof opts.display.images === 'boolean') {
			columns = process.stdout.columns - 1
		} else {
			columns = Number(opts.display.images)
		}
		imageToTerminal('Expected', image1, columns, grad, opts)
		imageToTerminal('Actual', image2, columns, grad, opts)
	}

	const result = {
		pass: passed,
		fail: !passed,
		difference: maxDiff,
		scorecard
	}

	if (opts.display.scorecard) {
		result.scorecard = scorecard
	}

	return result
}

const fuzi = (expectedImg, actualImg, opts) => {
	opts = deepmerge(defaultOpts, opts)
	return fuzzyMatch(expectedImg, actualImg, opts)
}

module.exports = fuzi
