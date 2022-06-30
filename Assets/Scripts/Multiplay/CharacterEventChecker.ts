import { Vector3, Collider, ControllerColliderHit, GameObject, Renderer } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import BlockMultiplay from './BlockMultiplay';
import { Physics, RaycastHit } from "UnityEngine";
import MultiMovingBlock from './MultiMovingBlock';
import MultiOrbitingBlock from './MultiOrbitingBlock';

export default class CharacterEventChecker extends ZepetoScriptBehaviour {

    private blockMultiplay: BlockMultiplay;
    private prevLandedPlatform: GameObject;
    private prevLandedBlock: GameObject;
    private isJumpingFromPlatformToBlock: boolean; // Is the character jumping from platform to block?
    private canCheckMovingFromPlatformToBlock: boolean; // Can the platform detect jumping to a block? (to avoid duplicate detection)
    private jumpPosition: Vector3 = Vector3.zero;
    private platformRenderer: Renderer;

    Start() {
        this.blockMultiplay = BlockMultiplay.GetInstance();
        this.prevLandedPlatform = null;
        this.prevLandedBlock = null;
        this.canCheckMovingFromPlatformToBlock = true;
        this.isJumpingFromPlatformToBlock = false;
    }

    Update() {
        // Sends a message to the server when a floor raycast hits a fall check trigger. 
        // - Detect movement between platform <-> blocks
        // - canCheckMovingFromPlatformToBlock checks to make sure code isn't run twice
        let ref = $ref<RaycastHit>();
        if (Physics.Raycast(this.transform.position, Vector3.down, ref, 1000)) {
            let hitInfo = $unref(ref);

            if (hitInfo.collider.tag == "FallCheckTrigger") {

                this.prevLandedPlatform = null;
                // If leaving from another platform. 
                if (false == this.isFirstLandingOnPlatform)
                    this.isFirstLandingOnPlatform = true;

                //  Platform -> Moving block. 
                if (this.canCheckMovingFromPlatformToBlock) {
                    this.canCheckMovingFromPlatformToBlock = false;
                    this.isJumpingFromPlatformToBlock = true;
                    // Send Message to Server: When moving from platform to platform, designate it as transport parent.  
                    // Send Character position/ Jump position at the moment of jump.
                    let relativePosition = this.transform.position - this.jumpPosition;
                    this.blockMultiplay.SendOnTryJumpForMovingToBlock(relativePosition, this.jumpPosition);
                }
            }

            //If the character returns to the current platform after initiating jump
            if (hitInfo.collider.tag == "Platform") {
                if (this.isJumpingFromPlatformToBlock) {
                    this.canCheckMovingFromPlatformToBlock = true;
                    this.isJumpingFromPlatformToBlock = false;
                    this.prevLandedBlock = null;
                }
            }
        }
    }

    OnControllerColliderHit(hit: ControllerColliderHit) {

        // If the landed block is a moving block, and is different than the previous block
        if (hit.gameObject.tag == "MovingBlock") {
            if (this.prevLandedBlock != hit.gameObject) {
                // Send a message to the server that the block has changed. 
                let movingBlock = hit.gameObject.transform.parent.GetComponent<MultiMovingBlock>();
                movingBlock.SetIsCharacterLandedOnBlock();
            }
            this.prevLandedBlock = hit.gameObject;
        }
        // If the landed block is an orbiting block and is different than the previous block
        if (hit.gameObject.tag == "OrbitingBlock") {
            if (this.prevLandedBlock != hit.gameObject) {
                // Send a message to the server that the block has changed. 
                let orbitingBlock = hit.gameObject.transform.parent.GetComponent<MultiOrbitingBlock>();
                orbitingBlock.SetIsCharacterLandedOnBlock();
            }
            this.prevLandedBlock = hit.gameObject;
        }

        if (hit.gameObject.tag != "Platform")
            return;

        // If landing on a platform that is not the previous platform. 
        if (this.prevLandedPlatform != hit.gameObject) {
            this.platformRenderer = hit.gameObject.GetComponentInChildren<Renderer>();
            this.isJumpingFromPlatformToBlock = false;
            this.canCheckMovingFromPlatformToBlock = true;
            this.prevLandedPlatform = hit.gameObject;
            this.prevLandedBlock = null;
            //Send message to server. 
            this.blockMultiplay.SendOnPlatformState();
        }

        //Character position above the current platform. 
        this.jumpPosition = new Vector3(this.gameObject.transform.position.x, this.platformRenderer.bounds.max.y, this.gameObject.transform.position.z);

    }

    private isFirstLandingOnPlatform: boolean = true;

    OnTriggerEnter(coll: Collider) {
        if (coll.gameObject.tag != "FallCheckTrigger") {
            return;
        }
        this.prevLandedPlatform = null;
    }

}