import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import * as solver from 'https://cdn.jsdelivr.net/npm/rubiks-cube-solver@1.2.0/+esm'
window.solver = solver

let renderer, camera, controls, raycaster, scene
let face_hitboxes

const move_history = []

// constants
const HALF_PI = Math.PI / 2
const PIECE_GAP = 1.1
const STICKER_GAP = 1.1
const STICKER_DIST = 1.5
const PLANE_DIST = 1.5
const FACE_ROTATION_TIME = 0.5

const COLOR_NAMES = { w: "white", g: "green", r: "red", b: "blue", o: "darkorange", y: "yellow" }
const FACE_COLORS = { U: "w", D: "y", L: "o", R: "r", F: "g", B: "b" }
const FACES = "UDLRFB"
const PLANES = "UDLRFBudlrfbMES"
const PLANE_AXES = {
	U: [0, 1, 0],
	D: [0, -1, 0],
	L: [-1, 0, 0],
	R: [1, 0, 0],
	F: [0, 0, 1],
	B: [0, 0, -1],
}
for (let k in PLANE_AXES) PLANE_AXES[k.toLowerCase()] = PLANE_AXES[k]
PLANE_AXES.M = PLANE_AXES.L
PLANE_AXES.E = PLANE_AXES.D
PLANE_AXES.S = PLANE_AXES.F
PLANE_AXES.X = PLANE_AXES.R
PLANE_AXES.Y = PLANE_AXES.U
PLANE_AXES.Z = PLANE_AXES.F
const plane_sets = {}
const plane_hitboxes = {}


// internal cube representation
let cube_string
let cube_rotation_lock = false

const cube = new THREE.Group()

function init() {
	// initialize three.js
	const canvas = document.querySelector('canvas#webgl')
	renderer = new THREE.WebGLRenderer({
		canvas: canvas,
		antialias: true,
	})
	document.body.appendChild(renderer.domElement)
	camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
	controls = new OrbitControls(camera, renderer.domElement)
	controls.enableDamping = true
	// controls.enableZoom = false
	controls.minDistance = 5
	controls.maxDistance = 20
	controls.enablePan = false
	raycaster = new THREE.Raycaster()
}

function add_event_handlers() {
	window.onresize = () => {
		camera.aspect = window.innerWidth / window.innerHeight
		camera.updateProjectionMatrix()
		controls.update()
		renderer.setSize(window.innerWidth, window.innerHeight)
	}
	window.onresize()
	window.onmousedown = (event) => {
		event.preventDefault()
		const mouse = new THREE.Vector2(1, 1)
		mouse.x = (event.clientX / window.innerWidth) * 2 - 1
		mouse.y = - (event.clientY / window.innerHeight) * 2 + 1
		raycaster.setFromCamera(mouse, camera)
		const intersection = raycaster.intersectObject(face_hitboxes)
		if (intersection.length <= 0) return
		const object = intersection[0].object
		let plane = object.userData.face
		// shift key rotates two layers
		if (event.shiftKey) plane = plane.toLowerCase()
		// ctrl key rotates middle layer
		if (event.ctrlKey) {
			if ("LRlr".includes(plane)) plane = "M"
			if ("UDud".includes(plane)) plane = "E"
			if ("FBfb".includes(plane)) plane = "S"
		}
		// alt key rotates cube
		if (event.altKey) {
			if ("LRlr".includes(plane)) plane = "x"
			if ("UDud".includes(plane)) plane = "y"
			if ("FBfb".includes(plane)) plane = "z"
		}
		let move = plane
		if (event.button != 0) move += "'"
		do_move(move)
	}
}



function create_scene() {
	scene = new THREE.Scene()
	camera.position.z = 8

	// background grey
	scene.background = new THREE.Color(0x333333)

	add_lights()
	// add_light_helpers()
	// show_basis_helpers()

	for (let face of FACES) plane_sets[face] = new Set()

	face_hitboxes = new THREE.Group()
	scene.add(face_hitboxes)

	for (let face of FACES) {
		const geometry = new THREE.BoxGeometry(3, 3, 1)
		const material = new THREE.MeshBasicMaterial({ color: 'grey' })
		const hitbox = new THREE.Mesh(geometry, material)
		face_hitboxes.add(hitbox)
		// material.transparent = true
		// material.opacity = 0.5
		hitbox.visible = false
		hitbox.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...PLANE_AXES[face]))
		hitbox.position.set(...PLANE_AXES[face])
		hitbox.position.multiplyScalar(PLANE_DIST)
		hitbox.userData.face = face
		plane_hitboxes[face] = hitbox
	}

	// Rounded rectangle
	function roundedRect(ctx, x, y, width, height, radius) {
		ctx.moveTo(x, y + radius);
		ctx.lineTo(x, y + height - radius);
		ctx.quadraticCurveTo(x, y + height, x + radius, y + height);
		ctx.lineTo(x + width - radius, y + height);
		ctx.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
		ctx.lineTo(x + width, y + radius);
		ctx.quadraticCurveTo(x + width, y, x + width - radius, y);
		ctx.lineTo(x + radius, y);
		ctx.quadraticCurveTo(x, y, x, y + radius);
	}


	cube_string = new CubeString()
	// create a 3x3x3 grid of cubes
	for (let x = -1; x <= 1; x++) {
		for (let y = -1; y <= 1; y++) {
			for (let z = -1; z <= 1; z++) {
				// let piece_type
				// if (!x && !y || !y && !z || !x && !z) piece_type = 'center'
				// else if (!x + !y + !z == 1) piece_type = 'edge'
				// else piece_type = 'corner'

				const material = new THREE.MeshBasicMaterial({ color: 'black' })
				// material.color.setRGB((x + 1) / 2, (y + 1) / 2, (z + 1) / 2)
				// material.color.setColorName(piece_type == 'edge' ? 'red' : piece_type == 'corner' ? 'green' : 'blue')
				// // make transparent
				// material.transparent = true
				// material.opacity = 0.5
				const piece = new THREE.Group()
				piece.userData.type = 'piece'
				cube.add(piece)
				const piece_cube = new THREE.Mesh(new THREE.BoxGeometry(1.09, 1.09, 1.09), material)
				piece_cube.userData.type = 'piece_cube'
				cube.add(piece_cube)
				piece.attach(piece_cube)
				piece_cube.position.set(x * PIECE_GAP, y * PIECE_GAP, z * PIECE_GAP)
				// center piece has no stickers
				if (!x && !y && !z) continue

				// add stickers
				const stickers = [
					[x * STICKER_DIST, y, z],
					[x, y * STICKER_DIST, z],
					[x, y, z * STICKER_DIST],
				]

				for (let s of stickers) {
					const [x1, y1, z1] = s
					// prune unnecessary stickers
					if (x1 == x && y1 == y && z1 == z) continue
					// const sticker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 'blue' }))

					// rounded square sticker
					const roundedRectShape = new THREE.Shape()
					roundedRect(roundedRectShape, -0.95 / 2, -0.95 / 2, 0.95, 0.95, 0.1)
					const extrudeSettings = { depth: 0.01, bevelEnabled: true, bevelSegments: 2, steps: 2, bevelSize: 0, bevelThickness: 0 }
					const sticker = new THREE.Mesh(new THREE.ExtrudeGeometry(roundedRectShape, extrudeSettings),
						new THREE.MeshStandardMaterial({
							roughness: 0.5,
							color: 'blue'
						}))
					sticker.userData.type = 'sticker'
					cube.add(sticker)
					piece.attach(sticker)
					// sticker.material.side = THREE.DoubleSide
					// rotate stickers
					if (x1 > x) sticker.rotateY(HALF_PI)
					if (y1 > y) sticker.rotateX(-HALF_PI)
					// if (z1 > z) sticker.rotateX(Math.PI)
					if (x1 < x) sticker.rotateY(-HALF_PI)
					if (y1 < y) sticker.rotateX(HALF_PI)
					if (z1 < z) sticker.rotateX(Math.PI)
					sticker.position.set(x1 * STICKER_GAP, y1 * STICKER_GAP, z1 * STICKER_GAP)
					// paint stickers

					let face
					if (x1 > x) face = 'R'
					if (x1 < x) face = 'L'
					if (z1 > z) face = 'F'
					if (z1 < z) face = 'B'
					if (y1 > y) face = 'U'
					if (y1 < y) face = 'D'
					sticker.material.color.setColorName(COLOR_NAMES[FACE_COLORS[face]])
				}
			}
		}
	}
	scene.add(cube)
	plane_sets.x = plane_sets.y = plane_sets.z = new Set(cube.children.filter(c => c.userData.type == 'piece'))
	update_piece_sets()
}

function show_basis_helpers() {
	// show basis vectors for debugging
	const basis = new THREE.Group()
	basis.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 'red'))
	basis.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, 'green'))
	basis.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1, 'blue'))
	scene.add(basis)
	basis.position.set(-5, 0, 0)
}

function add_lights() {
	// ambient light
	const ambient = new THREE.AmbientLight(0xffffff, 0.5)
	scene.add(ambient)

	// 3 point lighting
	const keyLight = new THREE.DirectionalLight(new THREE.Color('hsl(30, 100%, 75%)'), 1.0)
	const fillLight = new THREE.DirectionalLight(new THREE.Color('hsl(240, 100%, 75%)'), 0.75)
	const backLight = new THREE.DirectionalLight(0xffffff, 1.0)
	const spotLight = new THREE.SpotLight(0xffffff)
	keyLight.position.set(-105, 0, 105)
	fillLight.position.set(0, -105, -105)
	// backLight.position.set(105, 0, -105).normalize()
	spotLight.position.set(0, 0, 105)
	scene.add(spotLight)
	scene.add(keyLight)
	scene.add(fillLight)
	scene.add(backLight)
}

function add_light_helpers() {
	const spotLightHelper = new THREE.SpotLightHelper(spotLight)
	const keyLightHelper = new THREE.DirectionalLightHelper(keyLight, 0.5)
	const fillLightHelper = new THREE.DirectionalLightHelper(fillLight, 0.5)
	const backLightHelper = new THREE.DirectionalLightHelper(backLight, 0.5)
	scene.add(spotLightHelper)
	scene.add(keyLightHelper)
	scene.add(fillLightHelper)
	scene.add(backLightHelper)
}

function drawText(ctx, text, x, y) {
	ctx.save()
	ctx.strokeStyle = 'black'
	ctx.lineWidth = 2
	ctx.shadowColor = 'black'
	ctx.shadowBlur = 3
	ctx.lineJoin = 'round'
	ctx.miterLimit = 2
	ctx.strokeText(text, x, y)
	ctx.fillText(text, x, y)
	ctx.restore()
}

function centerText(ctx, text) {
	const { width, height } = ctx.canvas
	const x = width / 2 - ctx.measureText(text).width / 2
	// const y = height / 2 - ctx.measureText(text).height / 2
	const y = height / 2
	drawText(ctx, text, x, y)
}
function render_hud() {
	const width = window.innerWidth
	const height = window.innerHeight
	/** @type{CanvasRenderingContext2D}*/
	const hud_canvas = document.querySelector('canvas#hud')
	const hud = hud_canvas.getContext('2d')
	hud.clearRect(0, 0, width, height)


	hud.font = '200px monospace'
	hud.fillStyle = 'black'
	drawText(hud, 'worlsdsdfsifsidufosdufbisudbfiusidfusidufbidsufd.debug', 5, height - 10)
}

function update_piece_sets() {
	for (let plane of PLANES) {
		const pieces = new Set()
		for (let child of cube.children) {
			// check box intersection
			if (child.userData.type == 'piece') {
				const box = new THREE.Box3().setFromObject(child)
				const plane_box = new THREE.Box3()
				if (plane == "M")
					plane_box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 3, 3))
				else if (plane == "E")
					plane_box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 0, 3))
				else if (plane == "S")
					plane_box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 3, 0))
				else
					plane_box.setFromObject(plane_hitboxes[plane.toUpperCase()])
				// two layers
				if ("udlrfb".includes(plane)) plane_box.expandByScalar(0.5)
				if (box.intersectsBox(plane_box)) {
					pieces.add(child)
					child.userData.face = plane
				}
			}
		}
		plane_sets[plane] = pieces
	}
}


function rotate_piece_set(plane, anti = false) {
	if (cube_rotation_lock) return false
	cube_rotation_lock = true

	let axis = new THREE.Vector3(...PLANE_AXES[plane.toUpperCase()])
	let fps = 60
	const step = 1 / (FACE_ROTATION_TIME * fps) // step per frame
	const sign = anti ? -1 : 1
	const finalAngle = HALF_PI * sign
	const angleStep = finalAngle * step
	let t = 0

	// // visualize rotation axis
	// const geometry = new THREE.CylinderGeometry(0.1, 0.1, 10, 32)
	// const material = new THREE.MeshBasicMaterial({ color: 'red' })
	// const cylinder = new THREE.Mesh(geometry, material)
	// cylinder.position.set(0, 0, 0)
	// // align cylinder with rotation axis
	// cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
	// scene.add(cylinder)
	return new Promise((resolve, reject) => {
		function animate() {
			for (let piece of plane_sets[plane])
				piece.rotateOnWorldAxis(axis, angleStep)

			t += step
			if (t < 1) requestAnimationFrame(animate)
			else {
				for (let piece of plane_sets[plane]) {
					piece.rotation.x = Math.round(piece.rotation.x / HALF_PI) * HALF_PI
					piece.rotation.y = Math.round(piece.rotation.y / HALF_PI) * HALF_PI
					piece.rotation.z = Math.round(piece.rotation.z / HALF_PI) * HALF_PI
				}
				update_piece_sets()
				cube_rotation_lock = false
				resolve(true)
			}
		}
		animate()
	})
}


class CubeString {
	constructor() {
		this.cube_state = "wwwwwwwwwgggggggggrrrrrrrrrbbbbbbbbboooooooooyyyyyyyyy".split("")
	}
	rotate(anti, a, b, c, d) {
		if (!anti) {
			let temp = this.cube_state[a]
			this.cube_state[a] = this.cube_state[b]
			this.cube_state[b] = this.cube_state[c]
			this.cube_state[c] = this.cube_state[d]
			this.cube_state[d] = temp
		} else {
			let temp = this.cube_state[a]
			this.cube_state[a] = this.cube_state[d]
			this.cube_state[d] = this.cube_state[c]
			this.cube_state[c] = this.cube_state[b]
			this.cube_state[b] = temp
		}
	}
	move(m, anti = false) {
		if (m == 'U') {
			this.rotate(anti, 0, 2, 8, 6)//front corner
			this.rotate(anti, 1, 5, 7, 3)//front edge
			this.rotate(anti, 36, 27, 18, 9)//corner 1
			this.rotate(anti, 29, 20, 11, 38)//corner 2
			this.rotate(anti, 28, 19, 10, 37)//edge 1
		} else if (m == "F") {
			this.rotate(anti, 9, 11, 17, 15) // plus 9
			this.rotate(anti, 10, 14, 16, 12) // plus 9
			this.rotate(anti, 38, 8, 24, 45)
			this.rotate(anti, 6, 18, 47, 44)
			this.rotate(anti, 7, 21, 46, 41)
		} else if (m == "R") {
			this.rotate(anti, 18, 20, 26, 24)
			this.rotate(anti, 19, 23, 25, 21)
			this.rotate(anti, 11, 2, 33, 47)
			this.rotate(anti, 8, 27, 53, 17)
			this.rotate(anti, 5, 30, 50, 14)
		} else if (m == "B") {
			this.rotate(anti, 27, 29, 35, 33)
			this.rotate(anti, 28, 32, 34, 30)
			this.rotate(anti, 20, 0, 42, 53)
			this.rotate(anti, 2, 36, 51, 26)
			this.rotate(anti, 1, 39, 52, 23)
		} else if (m == "L") {
			this.rotate(anti, 36, 38, 44, 42)
			this.rotate(anti, 37, 41, 43, 39)
			this.rotate(anti, 29, 6, 15, 51)
			this.rotate(anti, 0, 9, 45, 35)
			this.rotate(anti, 3, 12, 48, 32)
		} else if (m == "D") {
			this.rotate(anti, 45, 47, 53, 51)
			this.rotate(anti, 46, 50, 52, 48)
			this.rotate(anti, 44, 17, 26, 35)
			this.rotate(anti, 15, 24, 33, 42)
			this.rotate(anti, 16, 25, 34, 43)
		} else if (m == "x") {
			this.move("R", anti)
			this.move("L", !anti)
			this.rotate(anti, 13, 4, 31, 49)
			this.rotate(anti, 10, 1, 34, 46)
			this.rotate(anti, 16, 7, 28, 52)
		} else if (m == "y") {
			this.move("U", anti)
			this.move("D", !anti)
			this.rotate(anti, 13, 40, 31, 22)
			this.rotate(anti, 12, 39, 30, 21)
			this.rotate(anti, 14, 41, 32, 23)
		} else if (m == "z") {
			this.move("F", anti)
			this.move("B", !anti)
			this.rotate(anti, 40, 4, 22, 49)
			this.rotate(anti, 37, 5, 25, 48)
			this.rotate(anti, 43, 3, 19, 50)
		} else if (m == "M") {
			this.move("x", !anti)
			this.move("L", !anti)
			this.move("R", anti)
		} else if (m == "E") {
			this.move("y", !anti)
			this.move("D", anti)
			this.move("U'", anti)
		} else if (m == "S") {
			this.move("z", !anti)
			this.move("B", !anti)
			this.move("F", anti)
		} else if (m == "u") {
			this.move("D", anti)
			this.move("y", anti)
		} else if (m == "f") {
			this.move("B", anti)
			this.move("z", anti)
		} else if (m == "r") {
			this.move("L", anti)
			this.move("x", anti)
		} else if (m == "b") {
			this.move("F", anti)
			this.move("z", !anti)
		} else if (m == "l") {
			this.move("R", anti)
			this.move("x", !anti)
		} else if (m == "d") {
			this.move("U", anti)
			this.move("y", !anti)
		}

	}
}


function tick() {
	controls.update()
	// render_hud()
	renderer.render(scene, camera)
	requestAnimationFrame(tick)
}

async function do_move(move, opp = false) {
	if (move.length == 1) move += " "

	const face = move[0]
	const times = move[1] == "2" ? 2 : 1
	let anti = move[1] == "'" ? false : true
	if (opp) anti = !anti

	for (let i = 0; i < times; i++) {
		if (await rotate_piece_set(face, anti))
			cube_string.move(face, anti)
	}
	console.debug(cube_string.cube_state.join(""))
	if (opp) move_history.push(move)
}

async function do_moves(moves, opp = false) {
	for (let i = 0; i < moves.length; i++) {
		if (!"udfblrUDFBLRMESxyz".includes(moves[i])) continue
		if (i + 1 < moves.length && "'2".includes(moves[i + 1])) {
			await do_move(moves[i] + moves[i + 1], opp)
			i++
		} else {
			await do_move(moves[i], opp)
		}
	}
}

async function add_gui() {
	const gui = new GUI()

	gui.add({
		scramble: async () => {
			const moves = []
			for (let i = 0; i < 20; i++) {
				const face = FACES[Math.floor(Math.random() * FACES.length)]
				const anti = Math.random() > 0.5
				moves.push(face + (anti ? "'" : ""))
			}
			await do_moves(moves)
		}
	}, 'scramble').name('Scramble')

	gui.add({
		reset_view: () => {
			// camera.position.set(0, 0, 8)
			const finalPos = new THREE.Vector3(0, 0, 8)
			const finalRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0)
			function animate() {
				camera.position.lerp(finalPos, 0.1)
				camera.quaternion.slerp(finalRot, 0.1)
				if (camera.position.distanceTo(finalPos) > 0.01) requestAnimationFrame(animate)
			}
			animate()
		}
	}, 'reset_view').name('Reset View')

	gui.add({
		enter_moves: () => {
			const moves = prompt("Enter moves")
			do_moves(moves)
		}
	}, 'enter_moves').name('Enter Moves')

	gui.add({
		reset_cube: () => {
			cube_string = new CubeString()
			for (let child of cube.children) {
				if (child.userData.type == 'piece') {
					child.rotation.set(0, 0, 0)
				}
			}
			update_piece_sets()
			move_history.length = 0
		}
	}, 'reset_cube').name('Reset Cube')

	gui.add({
		solve: async () => {
			const solution = solve(cube_string.cube_state)
			for (let k in solution) {
				if (solution[k].length == 0) continue
				console.log("Solving", k)
				console.log(solution[k])
				await do_moves(solution[k])
			}
		}
	}, 'solve').name('Solve')
}

function convert_state_to_solver_format(state) {
	const SOLVED_STATE = 'fffffffffrrrrrrrrruuuuuuuuudddddddddlllllllllbbbbbbbbb'
	const initial = 'wwwwwwwwwgggggggggrrrrrrrrrbbbbbbbbboooooooooyyyyyyyyy'
	const replace_map = { w: 'u', r: 'r', g: 'f', y: 'd', o: 'l', b: 'b' }
	const u = state.slice(9 * 0, 9 * 1)
	const f = state.slice(9 * 1, 9 * 2)
	const r = state.slice(9 * 2, 9 * 3)
	const b = state.slice(9 * 3, 9 * 4)
	const l = state.slice(9 * 4, 9 * 5)
	const d = state.slice(9 * 5, 9 * 6)
	return [...f, ...r, ...u, ...d, ...l, ...b].map(c => replace_map[c]).join("")
}

function convert_solution_to_moves(solution) {
	return solution.replace(/prime/g, "'").replace(/\s/g, "")
}

function solve(state) {
	const solver_state = convert_state_to_solver_format(state)
	// console.log('solver_state', solver_state)
	const solution = solver.default.default(solver_state, { partitioned: true })
	const { cross, f2l, oll, pll } = solution
	// console.log('solution', solution)
	// return convert_solution_to_moves([...cross, ...f2l, oll, pll].join(" "))
	return {
		cross: convert_solution_to_moves(cross.join("")),
		f2l: convert_solution_to_moves(f2l.join("")),
		oll: convert_solution_to_moves(oll),
		pll: convert_solution_to_moves(pll),
	}
}

init()
create_scene()
add_event_handlers()
add_gui()
tick()
