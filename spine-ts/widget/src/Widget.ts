/******************************************************************************
 * Spine Runtimes Software License v2.5
 *
 * Copyright (c) 2013-2016, Esoteric Software
 * All rights reserved.
 *
 * You are granted a perpetual, non-exclusive, non-sublicensable, and
 * non-transferable license to use, install, execute, and perform the Spine
 * Runtimes software and derivative works solely for personal or internal
 * use. Without the written permission of Esoteric Software (see Section 2 of
 * the Spine Software License Agreement), you may not (a) modify, translate,
 * adapt, or develop new applications using the Spine Runtimes or otherwise
 * create derivative works or improvements of the Spine Runtimes or (b) remove,
 * delete, alter, or obscure any trademarks or any copyright, trademark, patent,
 * or other intellectual property or proprietary rights notices on or in the
 * Software, including any copy thereof. Redistributions in binary or source
 * form must include this license and terms.
 *
 * THIS SOFTWARE IS PROVIDED BY ESOTERIC SOFTWARE "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
 * EVENT SHALL ESOTERIC SOFTWARE BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES, BUSINESS INTERRUPTION, OR LOSS OF
 * USE, DATA, OR PROFITS) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER
 * IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

module spine {
	export class SpineWidget {
		skeleton: Skeleton;
		state: AnimationState;
		gl: WebGLRenderingContext;
		canvas: HTMLCanvasElement;
		debugRenderer: spine.webgl.SkeletonDebugRenderer;

		private config: SpineWidgetConfig;
		private assetManager: spine.webgl.AssetManager;
		private shader: spine.webgl.Shader;
		private batcher: spine.webgl.PolygonBatcher;
		private shapes: spine.webgl.ShapeRenderer;
		private debugShader: spine.webgl.Shader;
		private mvp = new spine.webgl.Matrix4();
		private skeletonRenderer: spine.webgl.SkeletonRenderer;
		private paused = false;
		private lastFrameTime = Date.now() / 1000.0;
		private backgroundColor = new Color();
		private loaded = false;
		private bounds = { offset: new Vector2(), size: new Vector2() };

		constructor (element: HTMLElement | string, config: SpineWidgetConfig) {
			if (!element) throw new Error("Please provide a DOM element, e.g. document.getElementById('myelement')");
			if (!config) throw new Error("Please provide a configuration, specifying at least the json file, atlas file and animation name");

			let elementId = element as string;
			if (typeof(element) === "string") element = document.getElementById(element as string);
			if (element == null) throw new Error(`Element ${elementId} does not exist`);

			this.validateConfig(config);

			let canvas = this.canvas = document.createElement("canvas");
			canvas.style.width = "100%";
			canvas.style.height = "100%";
			(<HTMLElement> element).appendChild(canvas);
			canvas.width = (<HTMLElement>element).clientWidth;
			canvas.height = (<HTMLElement>element).clientHeight;
			var webglConfig = { alpha: config.alpha };
			let gl = this.gl = <WebGLRenderingContext> (canvas.getContext("webgl", webglConfig) || canvas.getContext("experimental-webgl", webglConfig));

			this.shader = spine.webgl.Shader.newColoredTextured(gl);
			this.batcher = new spine.webgl.PolygonBatcher(gl);
			this.mvp.ortho2d(0, 0, canvas.width - 1, canvas.height - 1);
			this.skeletonRenderer = new spine.webgl.SkeletonRenderer(gl);
			this.debugShader = spine.webgl.Shader.newColored(gl);
			this.debugRenderer = new spine.webgl.SkeletonDebugRenderer(gl);
			this.shapes = new spine.webgl.ShapeRenderer(gl);

			let assets = this.assetManager = new spine.webgl.AssetManager(gl);
			assets.loadText(config.atlas);
			assets.loadText(config.json);
			assets.loadTexture(config.atlas.replace(".atlas", ".png"));
			requestAnimationFrame(() => { this.load(); });
		}

		private validateConfig (config: SpineWidgetConfig) {
			if (!config.atlas) throw new Error("Please specify config.atlas");
			if (!config.json) throw new Error("Please specify config.json");
			if (!config.animation) throw new Error("Please specify config.animationName");

			if (!config.scale) config.scale = 1.0;
			if (!config.skin) config.skin = "default";
			if (config.loop === undefined) config.loop = true;
			if (!config.x) config.x = 0;
			if (!config.y) config.y = 0;
			if (config.fitToCanvas === undefined) config.fitToCanvas = true;
			if (!config.backgroundColor) config.backgroundColor = "#555555";
			if (!config.imagesPath) {
				let index = config.atlas.lastIndexOf("/");
				if (index != -1) {
					config.imagesPath = config.atlas.substr(0, index) + "/";
				} else {
					config.imagesPath = "";
				}
			}
			if (!config.premultipliedAlpha === undefined) config.premultipliedAlpha = false;
			if (!config.debug === undefined) config.debug = false;
			if (!config.alpha === undefined) config.alpha = true;
			this.backgroundColor.setFromString(config.backgroundColor);
			this.config = config;
		}

		private load () {
			let assetManager = this.assetManager;
			let imagesPath = this.config.imagesPath;
			let config = this.config;
			if (assetManager.isLoadingComplete()) {
				if (assetManager.hasErrors()) {
					if (config.error) config.error(this, "Failed to load assets: " + JSON.stringify(assetManager.getErrors()));
					else throw new Error("Failed to load assets: " + JSON.stringify(assetManager.getErrors()));
				}

				let atlas = new spine.TextureAtlas(this.assetManager.get(this.config.atlas) as string, (path: string) => {
					let texture = assetManager.get(imagesPath + path) as spine.webgl.GLTexture;
					return texture;
				});

				let atlasLoader = new spine.AtlasAttachmentLoader(atlas);
				var skeletonJson = new spine.SkeletonJson(atlasLoader);

				// Set the scale to apply during parsing, parse the file, and create a new skeleton.
				skeletonJson.scale = config.scale;
				var skeletonData = skeletonJson.readSkeletonData(assetManager.get(config.json) as string);
				var skeleton = this.skeleton = new spine.Skeleton(skeletonData);
				var bounds = this.bounds;
				skeleton.setSkinByName(config.skin);
				skeleton.setToSetupPose();
				skeleton.updateWorldTransform();
				skeleton.getBounds(bounds.offset, bounds.size);
				if (!config.fitToCanvas) {
					skeleton.x = config.x;
					skeleton.y = config.y;
				}

				var animationState = this.state = new spine.AnimationState(new spine.AnimationStateData(skeleton.data));
				animationState.setAnimation(0, config.animation, true);
				if (config.success) config.success(this);
				this.loaded = true;
				requestAnimationFrame(() => { this.render(); });
			} else
				requestAnimationFrame(() => { this.load(); });
		}

		private render () {
			var now = Date.now() / 1000;
			var delta = now - this.lastFrameTime;
			if (delta > 0.1) delta = 0;
			this.lastFrameTime = now;

			let gl = this.gl;
			let color = this.backgroundColor;
			this.resize();
			gl.clearColor(color.r, color.g, color.b, color.a);
			gl.clear(gl.COLOR_BUFFER_BIT);

			// Apply the animation state based on the delta time.
			var state = this.state;
			var skeleton = this.skeleton;
			var premultipliedAlpha = this.config.premultipliedAlpha;
			state.update(delta);
			state.apply(skeleton);
			skeleton.updateWorldTransform();

			// Draw the skeleton
			let shader = this.shader;
			let batcher = this.batcher;
			let skeletonRenderer = this.skeletonRenderer;
			shader.bind();
			shader.setUniformi(spine.webgl.Shader.SAMPLER, 0);
			shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, this.mvp.values);
			batcher.begin(shader);
			skeletonRenderer.premultipliedAlpha = premultipliedAlpha;
			skeletonRenderer.draw(batcher, skeleton);
			batcher.end();
			shader.unbind();

			// Draw debug information if requested via config
			if (this.config.debug) {
				let shader = this.debugShader;
				let shapes = this.shapes;
				let renderer = this.debugRenderer;
				shader.bind();
				shader.setUniform4x4f(spine.webgl.Shader.MVP_MATRIX, this.mvp.values);
				renderer.premultipliedAlpha = premultipliedAlpha;
				shapes.begin(shader);
				renderer.draw(shapes, skeleton);
				shapes.end();
				shader.unbind();
			}

			if (!this.paused) requestAnimationFrame(() => { this.render(); });
		}

		private resize () {
			let canvas = this.canvas;
			let w = canvas.clientWidth;
			let h = canvas.clientHeight;
			let bounds = this.bounds;
			if (canvas.width != w || canvas.height != h) {
				canvas.width = w;
				canvas.height = h;
			}

			// magic
			if (this.config.fitToCanvas) {
				var centerX = bounds.offset.x + bounds.size.x / 2;
				var centerY = bounds.offset.y + bounds.size.y / 2;
				var scaleX = bounds.size.x / canvas.width;
				var scaleY = bounds.size.y / canvas.height;
				var scale = Math.max(scaleX, scaleY) * 1.2;
				if (scale < 1) scale = 1;
				var width = canvas.width * scale;
				var height = canvas.height * scale;
				this.skeleton.x = this.skeleton.y = 0;
				this.mvp.ortho2d(centerX - width / 2, centerY - height / 2, width, height);
			} else {
				this.mvp.ortho2d(0, 0, canvas.width - 1, canvas.height - 1);
			}

			this.gl.viewport(0, 0, canvas.width, canvas.height);
		}

		pause () {
			this.paused = true;
		}

		play () {
			this.paused = false;
			requestAnimationFrame(() => { this.render(); });
		}

		isPlaying () {
			return !this.paused;
		}

		setAnimation (animationName: string) {
			if (!this.loaded) throw new Error("Widget isn't loaded yet");
			this.skeleton.setToSetupPose();
			this.state.setAnimation(0, animationName, this.config.loop);
		}


		static loadWidgets() {
			let widgets = document.getElementsByClassName("spine-widget");
			for (var i = 0; i < widgets.length; i++) {
				SpineWidget.loadWidget(<HTMLElement>widgets[i]);
			}
		}

		static loadWidget(widget: HTMLElement) {
			let config = new SpineWidgetConfig();
			config.atlas = widget.getAttribute("data-atlas");
			config.json = widget.getAttribute("data-json");
			config.animation = widget.getAttribute("data-animation");
			if (widget.getAttribute("data-images-path")) config.imagesPath = widget.getAttribute("data-images-path");
			if (widget.getAttribute("data-skin")) config.skin = widget.getAttribute("data-skin");
			if (widget.getAttribute("data-loop")) config.loop = widget.getAttribute("data-loop") === "true";
			if (widget.getAttribute("data-scale")) config.scale = parseFloat(widget.getAttribute("data-scale"));
			if (widget.getAttribute("data-x")) config.x = parseFloat(widget.getAttribute("data-x"));
			if (widget.getAttribute("data-y")) config.y = parseFloat(widget.getAttribute("data-y"));
			if (widget.getAttribute("data-fit-to-canvas")) config.fitToCanvas = widget.getAttribute("data-fit-to-canvas") === "true";
			if (widget.getAttribute("data-background-color")) config.backgroundColor = widget.getAttribute("data-background-color");
			if (widget.getAttribute("data-premultiplied-alpha")) config.premultipliedAlpha = widget.getAttribute("data-premultiplied-alpha") === "true";
			if (widget.getAttribute("data-debug")) config.debug = widget.getAttribute("data-debug") === "true";
			if (widget.getAttribute("data-alpha")) config.alpha = widget.getAttribute("data-alpha") === "true";

			new spine.SpineWidget(widget, config);
		}

		static pageLoaded = false;
		private static ready () {
			if (SpineWidget.pageLoaded) return;
			SpineWidget.pageLoaded = true;
			SpineWidget.loadWidgets();
		}

		static setupDOMListener() {
			if (document.addEventListener) {
				document.addEventListener("DOMContentLoaded", SpineWidget.ready, false);
				window.addEventListener("load", SpineWidget.ready, false);
			} else {
				(<any>document).attachEvent("onreadystatechange", function readyStateChange() {
					if (document.readyState === "complete" ) SpineWidget.ready();
				});
				(<any>window).attachEvent("onload", SpineWidget.ready);
			}
		}
	}

	export class SpineWidgetConfig {
		json: string;
		atlas: string;
		animation: string;
		imagesPath: string;
		skin = "default";
		loop = true;
		scale = 1.0;
		x = 0;
		y = 0;
		alpha = true;
		fitToCanvas = true;
		backgroundColor = "#555555";
		premultipliedAlpha = false;
		debug = false;
		success: (widget: SpineWidget) => void;
		error: (widget: SpineWidget, msg: string) => void;
	}
}
spine.SpineWidget.setupDOMListener();
