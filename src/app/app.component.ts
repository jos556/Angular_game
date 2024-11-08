import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, PLATFORM_ID, Inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { isPlatformBrowser } from '@angular/common';
import { TextureLoader } from 'three';

interface BlockData {
  mesh: THREE.Mesh;
  durability: number;
  maxDurability: number;
  level: number;
  breakingProgress: number;
  type: string;
}

interface InventoryItem {
  type: string;
  count: number;
  texture: THREE.Texture;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas') private canvasRef!: ElementRef<HTMLCanvasElement>;
  
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: PointerLockControls;
  private raycaster!: THREE.Raycaster;
  
  private blocks: Map<string, BlockData> = new Map();
  private hand!: THREE.Mesh;
  private isBreaking = false;
  private selectedBlock: BlockData | null = null;
  private breakingAnimation: number = 0;
  
  private moveForward = false;
  private moveBackward = false;
  private moveLeft = false;
  private moveRight = false;
  
  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private prevTime = performance.now();
  private isBrowser: boolean;

  private readonly GRID_SIZE = 20; // 地圖大小
  private readonly BLOCK_SPACING = 1; // 方塊間距
  private breakingSpeed = 0.05; // 降低破壞速度

  private blockPositions: Set<string> = new Set();

  private textureLoader!: TextureLoader;
  private textures: { [key: string]: THREE.Texture } = {};

  private inventory: Map<string, InventoryItem> = new Map();
  private selectedInventorySlot: number = 0;

  private eventHandlers: {
    mouseDown: (event: MouseEvent) => void;
    keyDown: (event: KeyboardEvent) => void;
    keyUp: (event: KeyboardEvent) => void;
    resize: () => void;
    mouseUp: (event: MouseEvent) => void;
    contextMenu: (event: Event) => void;
  } = {} as any;

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
    this.isBrowser = isPlatformBrowser(platformId);
    if (this.isBrowser) {
      this.textureLoader = new THREE.TextureLoader();
      this.initScene();
      this.loadTextures().then(() => {
        console.log('Textures loaded:', this.textures);
        this.initGame();
      }).catch(error => {
        console.error('Failed to load textures:', error);
        this.initGame();
      });
    }
  }

  private initScene(): void {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.raycaster = new THREE.Raycaster();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    this.scene.add(directionalLight);

    this.camera = new THREE.PerspectiveCamera(
      75, 
      window.innerWidth / window.innerHeight, 
      0.1, 
      1000
    );
    this.camera.position.y = 2;
    this.scene.add(this.camera);
  }

  private async loadTextures(): Promise<void> {
    const textureUrls = {
      dirt: 'assets/textures/dirt.png',
      stone: 'assets/textures/stone.png',
      iron: 'assets/textures/iron.png',
      wood: 'assets/textures/wood.png',
      hand: 'assets/textures/hand.jpg'
    };

    try {
      for (const [key, url] of Object.entries(textureUrls)) {
        console.log('Loading texture:', url);
        const texture = await this.textureLoader.loadAsync(url);
        
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.needsUpdate = true;
        
        this.textures[key] = texture;
        console.log(`Texture ${key} loaded successfully`);
      }
    } catch (error) {
      console.error('Error loading textures:', error);
    }
  }

  private initGame(): void {
    this.createGround();
    this.createHand();
    this.generateRandomBlocks();
  }

  private createGround(): void {
    const groundSize = this.GRID_SIZE * this.BLOCK_SPACING;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, this.GRID_SIZE, this.GRID_SIZE);
    const groundMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x567d46,
      side: THREE.DoubleSide,
      wireframe: true
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = Math.PI / 2;
    this.scene.add(ground);

    const solidGroundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
    const solidGroundMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x3d5d2f,
      side: THREE.DoubleSide
    });
    const solidGround = new THREE.Mesh(solidGroundGeometry, solidGroundMaterial);
    solidGround.rotation.x = Math.PI / 2;
    solidGround.position.y = -0.01;
    this.scene.add(solidGround);
  }

  private generateRandomBlocks(): void {
    const halfGrid = Math.floor(this.GRID_SIZE / 2);
    let attempts = 0;
    const maxAttempts = 1000;
    
    while (this.blocks.size < 100 && attempts < maxAttempts) {
      const x = Math.round((Math.random() * this.GRID_SIZE - halfGrid)) * this.BLOCK_SPACING;
      const z = Math.round((Math.random() * this.GRID_SIZE - halfGrid)) * this.BLOCK_SPACING;
      
      if (Math.abs(x) < 2 && Math.abs(z) < 2) {
        attempts++;
        continue;
      }
      
      let maxY = 0;
      for (let [key, block] of this.blocks.entries()) {
        if (block.mesh.position.x === x && block.mesh.position.z === z) {
          maxY = Math.max(maxY, block.mesh.position.y);
        }
      }
      
      const y = maxY === 0 ? 0.5 : maxY + 1;
      
      const key = `${x},${y},${z}`;
      if (!this.blocks.has(key)) {
        const level = Math.floor(Math.random() * 3) + 1;
        this.addBlock(x, y, z, level);
      }
      
      attempts++;
    }
  }

  private addBlock(x: number, y: number, z: number, level: number): void {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = this.getBlockTexture(level);
    
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      roughness: 0.8,
      metalness: 0.1
    });

    const block = new THREE.Mesh(geometry, material);
    block.position.set(
      Math.round(x),
      y,
      Math.round(z)
    );
    this.scene.add(block);

    const blockType = this.getBlockType(level);
    const blockData: BlockData = {
      mesh: block,
      durability: level * 3,
      maxDurability: level * 3,
      level: level,
      breakingProgress: 0,
      type: blockType
    };

    const key = `${x},${y},${z}`;
    const baseKey = `${x},${z}`;
    this.blocks.set(key, blockData);
    this.blockPositions.add(baseKey);
  }

  private getBlockTexture(level: number): THREE.Texture {
    let texture: THREE.Texture;
    
    switch(level) {
      case 1: 
        texture = this.textures['wood'];
        break;
      case 2: 
        texture = this.textures['stone'];
        break;
      case 3: 
        texture = this.textures['iron'];
        break;
      default: 
        texture = this.textures['dirt'];
    }

    if (!texture) {
      console.warn(`Texture not found for level ${level}, using fallback color`);
      const fallbackTexture = new THREE.Texture();
      fallbackTexture.needsUpdate = true;
      return fallbackTexture;
    }

    return texture;
  }

  private getBlockType(level: number): string {
    switch(level) {
      case 1: return 'wood';
      case 2: return 'stone';
      case 3: return 'iron';
      default: return 'wood';
    }
  }

  private createHand(): void {
    const handGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.5);
    const materials = [
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ map: this.textures['hand'], roughness: 0.5, metalness: 0.1 })
    ];

    this.hand = new THREE.Mesh(handGeometry, materials);
    
    this.hand.position.set(0.4, -0.3, -0.5);
    this.hand.rotation.z = Math.PI / 6;
    this.hand.rotation.y = -Math.PI / 12;
    
    this.camera.add(this.hand);
  }

  private addToInventory(blockType: string): void {
    const item = this.inventory.get(blockType);
    if (item) {
      item.count++;
    } else {
      this.inventory.set(blockType, {
        type: blockType,
        count: 1,
        texture: this.getBlockTexture(this.getBlockLevel(blockType))
      });
    }
    this.updateInventoryDisplay();
  }

  private getBlockLevel(blockType: string): number {
    switch(blockType) {
      case 'wood': return 1;
      case 'stone': return 2;
      case 'iron': return 3;
      default: return 1;
    }
  }

  private updateInventoryDisplay(): void {
    const inventoryContainer = document.querySelector('.inventory-container');
    if (!inventoryContainer) return;

    inventoryContainer.innerHTML = '';
    this.inventory.forEach((item, type) => {
      const slot = document.createElement('div');
      slot.className = 'inventory-slot';
      slot.innerHTML = `
        <img src="${this.getTexturePreview(item.texture)}" alt="${type}">
        <span class="item-count">${item.count}</span>
      `;
      slot.onclick = () => this.selectInventorySlot(type);
      inventoryContainer.appendChild(slot);
    });
  }

  private getTexturePreview(texture: THREE.Texture): string {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const img = texture.image;
    ctx.drawImage(img, 0, 0, 32, 32);
    return canvas.toDataURL();
  }

  private selectInventorySlot(type: string): void {
    this.selectedInventorySlot = Array.from(this.inventory.keys()).indexOf(type);
  }

  private placeBlock(): void {
    if (this.inventory.size === 0) return;

    const selectedType = Array.from(this.inventory.keys())[this.selectedInventorySlot];
    const item = this.inventory.get(selectedType);
    if (!item || item.count <= 0) return;

    const center = new THREE.Vector2(0, 0);
    this.raycaster.setFromCamera(center, this.camera);
    
    const intersects = this.raycaster.intersectObjects([
      ...Array.from(this.blocks.values()).map(block => block.mesh),
      ...this.scene.children.filter(child => child instanceof THREE.Mesh && 
        (child.material as THREE.MeshBasicMaterial).color.getHex() === 0x3d5d2f)
    ]);

    if (intersects.length > 0) {
      const intersection = intersects[0];
      const point = intersection.point;
      const normal = intersection.face!.normal;
      
      const targetPosition = point.clone().add(normal.multiplyScalar(0.5));
      const x = Math.round(targetPosition.x);
      const z = Math.round(targetPosition.z);
      
      let currentHeight = 0;
      let blocksAtPosition = Array.from(this.blocks.values()).filter(block => 
        block.mesh.position.x === x && block.mesh.position.z === z
      );
      
      if (blocksAtPosition.length > 0) {
        currentHeight = Math.max(...blocksAtPosition.map(block => block.mesh.position.y));
      }

      let y: number;
      if (currentHeight === 0) {
        y = 0.5;
      } else if (currentHeight === 0.5) {
        y = 1.5;
      } else if (currentHeight === 1.5) {
        y = 2.5;
      } else {
        return;
      }

      const key = `${x},${y},${z}`;
      if (!this.blocks.has(key)) {
        const halfGrid = Math.floor(this.GRID_SIZE / 2);
        if (Math.abs(x) <= halfGrid * this.BLOCK_SPACING && 
            Math.abs(z) <= halfGrid * this.BLOCK_SPACING) {
          
          this.addBlock(
            x,
            y,
            z,
            this.getBlockLevel(selectedType)
          );
          
          item.count--;
          if (item.count <= 0) {
            this.inventory.delete(selectedType);
          }
          this.updateInventoryDisplay();
        }
      }
    }
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    if (this.camera) {
      this.controls = new PointerLockControls(this.camera, document.body);

      const handleMouseDown = (event: MouseEvent) => {
        event.preventDefault();
        
        if (!this.controls.isLocked) {
          this.controls.lock();
          return;
        }
        
        if (event.button === 0) {
          this.isBreaking = true;
          this.startBreaking();
        }
        else if (event.button === 2) {
          this.placeBlock();
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => this.onKeyDown(event);
      const handleKeyUp = (event: KeyboardEvent) => this.onKeyUp(event);
      const handleResize = () => this.onWindowResize();
      const handleMouseUp = (event: MouseEvent) => {
        if (event.button === 0) {
          this.isBreaking = false;
          this.stopBreaking();
        }
      };
      const handleContextMenu = (event: Event) => event.preventDefault();

      document.addEventListener('mousedown', handleMouseDown, false);
      document.addEventListener('keydown', handleKeyDown);
      document.addEventListener('keyup', handleKeyUp);
      window.addEventListener('resize', handleResize);
      document.addEventListener('mouseup', handleMouseUp, false);
      document.addEventListener('contextmenu', handleContextMenu, false);

      this.eventHandlers = {
        mouseDown: handleMouseDown,
        keyDown: handleKeyDown,
        keyUp: handleKeyUp,
        resize: handleResize,
        mouseUp: handleMouseUp,
        contextMenu: handleContextMenu
      };

      this.animate();
    }
  }

  private startBreaking(): void {
    if (!this.controls.isLocked || !this.isBreaking) return;
    
    if (!this.selectedBlock) {
      this.checkBlockSelection();
    }
    
    if (this.selectedBlock) {
      this.selectedBlock.breakingProgress += this.breakingSpeed;
      
      const progress = this.selectedBlock.breakingProgress;
      const opacity = 1 - (progress / this.selectedBlock.durability);
      this.updateBlockOpacity(this.selectedBlock, opacity);
      
      this.playHandAnimation();

      if (Math.floor(this.selectedBlock.breakingProgress) >= this.selectedBlock.durability) {
        const position = this.selectedBlock.mesh.position;
        const key = `${position.x},${position.y},${position.z}`;
        const baseKey = `${position.x},${position.z}`;
        
        const blockType = this.selectedBlock.type;
        
        this.scene.remove(this.selectedBlock.mesh);
        this.blocks.delete(key);
        
        let hasBlocksAbove = false;
        for (let [k, v] of this.blocks.entries()) {
          if (v.mesh.position.x === position.x && 
              v.mesh.position.z === position.z && 
              v.mesh.position.y > position.y) {
            hasBlocksAbove = true;
            break;
          }
        }
        
        if (!hasBlocksAbove) {
          this.blockPositions.delete(baseKey);
        }
        
        this.generateNewBlock();
        this.addToInventory(blockType);
        this.selectedBlock = null;
      }
    }
  }

  private stopBreaking(): void {
    this.isBreaking = false;
    this.hand.rotation.x = 0;
    this.breakingAnimation = 0;
  }

  private checkBlockSelection(): void {
    const center = new THREE.Vector2(0, 0);
    this.raycaster.setFromCamera(center, this.camera);
    
    const blockMeshes = Array.from(this.blocks.values()).map(block => block.mesh);
    
    const intersects = this.raycaster.intersectObjects(blockMeshes, false);

    if (intersects.length > 0) {
      const intersection = intersects[0];
      const position = intersection.object.position;
      const key = `${position.x},${position.y},${position.z}`;
      const block = this.blocks.get(key);
      
      this.selectedBlock = block || null;
      
      console.log('Selected block:', {
        position: position,
        key: key,
        block: this.selectedBlock
      });
    } else {
      this.selectedBlock = null;
    }
  }

  private generateNewBlock(): void {
    const halfGrid = Math.floor(this.GRID_SIZE / 2);
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
      const x = Math.round((Math.random() * this.GRID_SIZE - halfGrid)) * this.BLOCK_SPACING;
      const z = Math.round((Math.random() * this.GRID_SIZE - halfGrid)) * this.BLOCK_SPACING;
      
      let maxY = 0;
      for (let [key, block] of this.blocks.entries()) {
        if (block.mesh.position.x === x && block.mesh.position.z === z) {
          maxY = Math.max(maxY, block.mesh.position.y);
        }
      }
      
      const y = maxY + (maxY > 0 ? 1 : 0.5);
      
      if (maxY === 0 || Math.random() < 0.3) {
        const level = Math.floor(Math.random() * 3) + 1;
        this.addBlock(x, y, z, level);
        break;
      }
      
      attempts++;
    }
  }

  private onWindowResize(): void {
    if (!this.isBrowser) return;
    
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private onKeyDown(event: KeyboardEvent): void {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = true;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = true;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = true;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = true;
        break;
    }
  }

  private onKeyUp(event: KeyboardEvent): void {
    switch (event.code) {
      case 'ArrowUp':
      case 'KeyW':
        this.moveForward = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.moveBackward = false;
        break;
      case 'ArrowLeft':
      case 'KeyA':
        this.moveLeft = false;
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.moveRight = false;
        break;
    }
  }

  private animate(): void {
    requestAnimationFrame(() => this.animate());

    if (this.controls.isLocked) {
      const time = performance.now();
      const delta = (time - this.prevTime) / 1000;

      const movementSpeed = 200.0;
      const friction = 5.0;

      this.velocity.x -= this.velocity.x * friction * delta;
      this.velocity.z -= this.velocity.z * friction * delta;

      this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
      this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
      this.direction.normalize();

      if (this.moveForward || this.moveBackward) {
        this.velocity.z -= this.direction.z * movementSpeed * delta;
      }
      if (this.moveLeft || this.moveRight) {
        this.velocity.x -= this.direction.x * movementSpeed * delta;
      }

      this.controls.moveRight(-this.velocity.x * delta);
      this.controls.moveForward(-this.velocity.z * delta);

      if (this.isBreaking) {
        this.startBreaking();
      }

      this.prevTime = time;
    }

    this.renderer.render(this.scene, this.camera);
  }

  private playHandAnimation(): void {
    this.hand.rotation.x = 0;
    
    const startTime = performance.now();
    const animationDuration = 300;
    const maxRotation = Math.PI / 2;
    
    const animate = () => {
      const currentTime = performance.now();
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / animationDuration, 1);
      
      const swingProgress = Math.sin(progress * Math.PI);
      this.hand.rotation.x = maxRotation * swingProgress * (1 - progress * 0.5);
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.hand.rotation.x = 0;
      }
    };
    
    requestAnimationFrame(animate);
  }

  private updateBlockOpacity(block: BlockData, opacity: number): void {
    const material = block.mesh.material as THREE.MeshStandardMaterial;
    if (material) {
      material.transparent = true;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }

  ngOnDestroy(): void {
    if (!this.isBrowser) return;

    document.removeEventListener('mousedown', this.eventHandlers.mouseDown);
    document.removeEventListener('keydown', this.eventHandlers.keyDown);
    document.removeEventListener('keyup', this.eventHandlers.keyUp);
    window.removeEventListener('resize', this.eventHandlers.resize);
    document.removeEventListener('mouseup', this.eventHandlers.mouseUp);
    document.removeEventListener('contextmenu', this.eventHandlers.contextMenu);
  }
}
