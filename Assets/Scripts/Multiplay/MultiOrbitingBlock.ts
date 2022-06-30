import { CharacterController, Quaternion, Collider, Time, Vector3, Transform, Renderer, Random } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { CharacterState, ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'
import BlockMultiplay from './BlockMultiplay';

export default class MultiOrbitingBlock extends ZepetoScriptBehaviour {

    // Block orbit variables
    @Header("Orbit Block")
    public rotSpeed: number = 0;
    public rotatingPoint: Transform;
    public characterSpeedControlValue: number = 6;

    private startPosition: Vector3;
    private startRotation: Quaternion;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    // Multiplayer Sync Variables
    private isMultiplayMode: boolean = false;
    private syncCharacterTransforms: Map<string, Transform> = new Map<string, Transform>();
    private myIdx: number = 0;

    private isLocalPlayerOnBlock: boolean = false;

    private rotateAroundAxis: Vector3;

    private prevBlockPosition: Vector3 = Vector3.zero;

    private isFixedPosition: boolean;
    private blockMultiplayManager: BlockMultiplay;
    private isLocalCharacterLanded: boolean = false;
    private relativePosAtJump: Vector3;

    private IsJumpingOnBlock: boolean = false;
    private renderer: Renderer;

    private Start() {
        this.startPosition = this.transform.position;
        this.startRotation = this.transform.rotation;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
        this.isMultiplayMode = false;

        this.rotateAroundAxis = Vector3.down;
        this.relativePosAtJump = Vector3.zero;

        this.renderer = this.GetComponentInChildren<Renderer>();
    }

    private Update() {

        // Block orbit
        this.transform.RotateAround(this.rotatingPoint.position, this.rotateAroundAxis, this.rotSpeed * Time.deltaTime);

        // Move the characters along with the orbiting block
        this.MoveCharacterWithBlock();
    }

    private OnTriggerEnter(coll: Collider) {

        if (coll.gameObject == this.localCharacter.gameObject) {
            this.isLocalPlayerOnBlock = true;
        } else {
            return;
        }

        if (false == this.isMultiplayMode) {
            return;
        }

        this.blockMultiplayManager?.SendOnBlockTriggerEnter(this.myIdx);
    }


    private OnTriggerStay(coll: Collider) {
        if (false == this.isMultiplayMode) {
            return;
        }
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }

        // A conditional statement to send a message about the landing location only once.
        if (this.isLocalCharacterLanded) {
            this.isLocalCharacterLanded = false;
            if (this.isMultiplayMode) {
                let diff = this.transform.position - this.localCharacter.transform.position;
                this.blockMultiplayManager.SendOnLandedBlock(this.myIdx, diff);
            }
        }

        if (this.localCharacter.CurrentState == CharacterState.JumpIdle || this.localCharacter.CurrentState == CharacterState.JumpMove) {
            this.relativePosAtJump = this.transform.position - this.localCharacter.transform.position;
        }
    }

    private OnTriggerExit(coll: Collider) {

        if (coll.gameObject == this.localCharacter.gameObject) {
            this.isLocalPlayerOnBlock = false;
        } else {
            return;
        }
        if (false == this.isMultiplayMode || true == this.stopToDetectTriggerExit) {
            return;
        }
        // Send message to server if local player character (player.isOnBlock = false)
        this.blockMultiplayManager?.SendOnBlockTriggerExit(this.myIdx, this.relativePosAtJump);

    }

    public SetIsCharacterLandedOnBlock() {
        this.isLocalCharacterLanded = true;
    }

    /* MoveCharacterWithBlock() 
       - Move the character along with the block
    */
    private MoveCharacterWithBlock() {

        // Block movement direction vector 
        let curBlockPosition = this.transform.position;
        let forwardVector = (curBlockPosition - this.prevBlockPosition).normalized;
        this.prevBlockPosition = this.transform.position;

        // Move the local character
        if (this.isLocalPlayerOnBlock) {
            this.localCharacterController.Move(forwardVector * (this.rotSpeed / this.characterSpeedControlValue) * Time.deltaTime);
        }

        if (this.syncCharacterTransforms.size == 0)
            return;

        // Move the multiplay character
        this.syncCharacterTransforms.forEach((characterTr: Transform, name: string) => {

            if (null != characterTr) {
                characterTr.RotateAround(this.rotatingPoint.position, this.rotateAroundAxis, this.rotSpeed * Time.deltaTime);
            } else {
                this.syncCharacterTransforms.delete(name);
            }
        });
    }


    // ---------------------------------- Multiplay -----------------------------------
    /* SetBlockIdx()
       - Sets the index of the current block to synchronize the position of the character on the block in multiplayer.
    */
    public SetBlockIdx(idx: number) {
        this.myIdx = idx;
    }

    /* SetMultiRoomElapsedTime()
       - Sets the time elapsed in the current room for block position synchronization during multiplayer synchronization.
    */
    public InitMultiplayMode(elapsedTime: number) {
        // Enable multiplayer mode
        this.isMultiplayMode = true;
        if (null == this.blockMultiplayManager) {
            this.blockMultiplayManager = BlockMultiplay.GetInstance();
        }
        // Execute only the first time.
        this.CalculatePredictedTransform(elapsedTime);
    }

    private stopToDetectTriggerExit: boolean = false;
    /* CalculatePredictedPosition()
       - Calculates the predicted position of the block based on the time elapsed in the current room.
    */
    public CalculatePredictedTransform(elapsedTime: number) {

        let center = this.rotatingPoint.position;
        let axis = this.rotateAroundAxis;
        let angle = this.rotSpeed * elapsedTime;

        // Rotate Around Algorithm
        let pos: Vector3 = this.startPosition;
        let rot: Quaternion = Quaternion.AngleAxis(angle, axis);
        let dir: Vector3 = pos - center;
        dir = rot * dir;
        let predictedPos = center + dir;
        let myRot: Quaternion = this.startRotation;
        let predictedRot = myRot * Quaternion.Inverse(myRot) * rot * myRot;

        // Adjust the position and movement direction of the block to the predicted values
        this.transform.position = predictedPos;
        this.transform.rotation = predictedRot;

        // Local character repositioning
        if (this.isLocalPlayerOnBlock) {
            this.StartCoroutine(this.TeleportCharacter(predictedPos));
        }

        // Synchronization characters will be coordinated by the server.
        this.syncCharacterTransforms.forEach((characterTr: Transform, name: string) => {
            if (null != characterTr) {
                let characterPosition = new Vector3(predictedPos.x, this.renderer.bounds.max.y, predictedPos.z);
                characterTr.position = characterPosition;
            } else {
                // If the player leaves the room while on a block.
                this.syncCharacterTransforms.delete(name);
            }
        });
    }

    private *TeleportCharacter(predictedPos: Vector3) {

        this.stopToDetectTriggerExit = true; // Ignore anything out of trigger during positioning
        this.isLocalPlayerOnBlock = false; // To ensure that blocks don't carry their characters while teleporting

        while (true) {
            yield null;
            let adjustValue = Random.Range(-0.3, 0.3);
            let targetPos = new Vector3(predictedPos.x + adjustValue, this.renderer.bounds.max.y, predictedPos.z + adjustValue);

            this.localCharacter.transform.position = targetPos;

            if (this.localCharacter.transform.position == targetPos) {
                this.stopToDetectTriggerExit = false;
                break;
            }
        }
    }

    /* AddCharacterOnBlock()
      - Register the character to be carried by the block.
    */
    public AddCharacterOnBlock(sessionId: string, relativeVector: Vector3, carrierParent: Transform) {
        let position = this.transform.position - relativeVector;
        let result = new Vector3(position.x, this.renderer.bounds.max.y, position.z);

        carrierParent.position = result;

        if (false == this.syncCharacterTransforms.has(sessionId)) {
            this.syncCharacterTransforms.set(sessionId, carrierParent);
        }
    }

    /* RemoveCharacterOnBlock()
       - Remove block from the character its carrying.
    */
    public RemoveCharacterOnBlock(sessionId: string, relativePos: Vector3, carrierParent: Transform) {
        let position = this.transform.position - relativePos;
        carrierParent.position = position;

        if (this.syncCharacterTransforms.has(sessionId)) {
            this.syncCharacterTransforms.delete(sessionId);
        }

    }

    public HasPlayerInCarrierPool(sessionId: string): boolean {
        if (this.syncCharacterTransforms.has(sessionId)) {
            return true;
        } else {
            return false;
        }
    }

}