import { CharacterController, Collider, Mathf, Quaternion, Random, Renderer, Rigidbody, Time, Transform, Vector3 } from 'UnityEngine';
import { Text } from 'UnityEngine.UI'
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { CharacterState, ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'
import BlockMultiplay from './BlockMultiplay';

export default class MultiMovingBlock extends ZepetoScriptBehaviour {

    //Block movement variables.
    @Header("Move Block")
    public rigidbody: Rigidbody;
    public moveSpeed: Vector3;
    public timeToMove: number = 1;

    private moveDirection: int;
    private startPosition: Vector3;
    private goalPosition: Vector3;

    private isLocalPlayerOnBlock: boolean = false;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    // Block rotation variables.
    @Header("Rotate Block (Option)")
    public isBlockRotating: boolean;
    public eulerAngleVelocity: Vector3;

    public characterRotateAroundSpeed: number = -1;

    // Multiplay Sync variables
    @Header("Multiplay Sync Setting")
    private isMultiplayMode: boolean = false;
    private myIdx: number = 0;

    private relativePosAtTryJump: Vector3 = Vector3.zero;
    private syncCharacterRigidbodies: Map<string, Rigidbody> = new Map<string, Rigidbody>();

    private clientElapsedTime: number = 0;

    private prevDirection: number;
    private shouldFixTransform: boolean = false;
    private blockMultiplayManager: BlockMultiplay;
    private renderer: Renderer;

    private Start() {

        this.moveDirection = 1;
        this.prevDirection = -1;

        this.rigidbody.useGravity = false;
        this.rigidbody.isKinematic = false;
        this.rigidbody.freezeRotation = true;
        this.rigidbody.velocity = this.moveSpeed * this.moveDirection;

        this.startPosition = this.transform.position;

        this.goalPosition = this.transform.position + this.moveSpeed * this.timeToMove;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            const myPlayer = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer;
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();

        });

        this.isLocalPlayerOnBlock = false;
        this.isMultiplayMode = false;

        this.renderer = this.GetComponentInChildren<Renderer>();
    }

    private FixedUpdate() {
        // Client Elapsed time
        this.clientElapsedTime += Time.fixedDeltaTime;

        // Move the block based on the elapsed time in the room
        this.MoveBlock(this.clientElapsedTime);

        this.MoveLocalCharacterWithBlock();
        if (false == this.isBlockRotating)
            return;

        // Block/Character Rotation
        this.RotateBlock();
        this.RotateCharacterWithBlock();
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
        // If the player is a local character, send a message to the server. (player.isOnBlock = true)
        this.blockMultiplayManager?.SendOnBlockTriggerEnter(this.myIdx);
    }

    private OnTriggerStay(coll: Collider) {

        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }

        /* -------- Position Synchronization Logic --------*/
        // Send a message when landing on floor
        if (this.isLocalCharacterLanded) {
            this.isLocalCharacterLanded = false;
            if (this.isMultiplayMode) {
                let relativeVector = this.transform.position - this.localCharacter.transform.position;
                this.blockMultiplayManager?.SendOnLandedBlock(this.myIdx, relativeVector);
            }
        }

        // JUMP EVNET
        if (this.localCharacter.CurrentState == CharacterState.JumpIdle || this.localCharacter.CurrentState == CharacterState.JumpMove) {
            this.relativePosAtTryJump = this.transform.position - this.localCharacter.transform.position;
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
        this.blockMultiplayManager?.SendOnBlockTriggerExit(this.myIdx, this.relativePosAtTryJump);
    }

    /* MoveCharacterWithBlock() 
       - Move the character along with the block
    */
    private MoveLocalCharacterWithBlock() {
        if (false == this.isLocalPlayerOnBlock)
            return;

        let velocity = this.moveSpeed * this.moveDirection;

        this.localCharacterController.Move(velocity * Time.fixedDeltaTime);
    }

    /* ChangeSyncCharacterVelocity() 
       - When the block velocity is changed, move the character to move at the same velocity
    */
    private ChangeSyncCharacterVelocity() {
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {
            rb.velocity = this.rigidbody.velocity;
        });
    }

    /* RotateBlock() 
        - Rotate block if the block rotation option is on
    */
    private RotateBlock() {
        let deltaRotation: Quaternion = Quaternion.Euler(this.eulerAngleVelocity * Time.fixedDeltaTime);
        this.rigidbody.MoveRotation(this.rigidbody.rotation * deltaRotation);
    }

    /* RotateCharacterWithBlock() 
       - Rotate the character with the block if the block rotation option is on 
    */
    private RotateCharacterWithBlock() {
        // Local Character rotation
        if (this.isLocalPlayerOnBlock) {
            this.localCharacter.transform.RotateAround(this.transform.position, Vector3.down, this.characterRotateAroundSpeed);
        }

        // Multi Character rotation
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {

            if (null != rb) {
                rb.gameObject.transform.RotateAround(this.transform.position, Vector3.down, this.characterRotateAroundSpeed);
            } else {
                this.syncCharacterRigidbodies.delete(name);
            }

        });
    }

    // ---------------------------------- Multiplay -----------------------------------
    /* InitMultiplayMode()
       - Resets the values for multiplayer sync when first entering or returning from the background.
    */
    public InitMultiplayMode(elapsedTime: number) {
        this.isMultiplayMode = true;
        if (null == this.blockMultiplayManager) {
            this.blockMultiplayManager = BlockMultiplay.GetInstance();
        }
        this.shouldFixTransform = true;
        // Apply the predicted location based on server time for the first time
        this.MoveBlock(elapsedTime);

        // If the server time changes, the elapsed time of the client is also adjusted accordingly.
        this.clientElapsedTime = elapsedTime;
    }


    private stopToDetectTriggerExit: boolean = false;

    /* CalculatePredictedPosition()
       - Sets the movement direction of the block based on the time elapsed in the current server's room.
    */
    public MoveBlock(elapsedTime: number) {

        let predictedDir: number = (Mathf.Floor(elapsedTime / this.timeToMove)) % 2 == 0 ? 1 : -1;

        // movement direction assigned as predicted direction
        this.moveDirection = predictedDir;

        // If the velocity is different than the previous, then reapply
        if (this.moveDirection != this.prevDirection) {
            // Reapply movement speed.
            this.rigidbody.velocity = this.moveSpeed * this.moveDirection;
            // Reapply the velocity of the other multiplay characters
            this.ChangeSyncCharacterVelocity();
        }

        this.prevDirection = this.moveDirection;
        // Adjust the location only when you log in for the first time and when you return from the background
        if (this.shouldFixTransform) {
            this.CalculatePredictedPosition(elapsedTime);
        }
    }

    CalculatePredictedPosition(elapsedTime: number) {
        this.shouldFixTransform = false;
        let basePos: Vector3 = this.moveDirection == 1 ? this.startPosition : this.goalPosition;
        let predictedPos: Vector3 = basePos + (this.moveSpeed * this.moveDirection) * (elapsedTime % this.timeToMove);

        // Adjust block position
        this.transform.position = predictedPos;
        // Adjust Local/Multi character position
        this.ResetCharactersTransform(predictedPos);
    }

    ResetCharactersTransform(predictedPos: Vector3) {
        // Local character position adjustment.
        if (this.isLocalPlayerOnBlock) {
            this.StartCoroutine(this.TeleportCharacter(predictedPos));
        }

        // Multi character position adjustment
        this.syncCharacterRigidbodies.forEach((rb: Rigidbody, name: string) => {
            if (null != rb) {
                let adjustValue = Random.Range(-0.3, 0.3);
                let characterPosition = new Vector3(predictedPos.x + adjustValue, this.renderer.bounds.max.y, predictedPos.z + adjustValue);
                rb.transform.position = characterPosition;
                this.ChangeSyncCharacterVelocity();
            } else {
                // If leaving while on top of a block
                this.syncCharacterRigidbodies.delete(name);
            }
        });
    }

    /* TeleportCharacter()
       - Move the character onto a block.
    */
    private *TeleportCharacter(predictedPos: Vector3) {
        this.stopToDetectTriggerExit = true; // Ignore anything out of trigger during positioning
        this.isLocalPlayerOnBlock = false; // To ensure that blocks don't carry characters while teleporting
        while (true) {
            yield null;
            let targetPos = new Vector3(predictedPos.x, this.renderer.bounds.max.y, predictedPos.z);

            this.localCharacter.transform.position = targetPos;

            if (this.localCharacter.transform.position == targetPos) {
                this.stopToDetectTriggerExit = false;
                break;
            }
        }
    }

    /* AddCharacterOnBlock()
       - Assign the character to be carried by the block.
    */
    public AddCharacterOnBlock(sessionId: string, relativeVector: Vector3, carrierParent: Transform) {

        let position = this.transform.position - relativeVector;
        let result = new Vector3(position.x, this.renderer.bounds.max.y, position.z);
        carrierParent.position = result;

        if (false == this.syncCharacterRigidbodies.has(sessionId)) {
            let rigidbody = carrierParent.GetComponent<Rigidbody>();
            this.syncCharacterRigidbodies.set(sessionId, rigidbody);

            // velocity intialization
            rigidbody.velocity = this.moveSpeed * this.moveDirection;
        }
    }

    /* RemoveCharacterOnBlock()
       - Remove the character from the carrier parent.
    */
    public RemoveCharacterOnBlock(sessionId: string, relativePos: Vector3, carrierParent: Transform) {

        let position = this.transform.position - relativePos;
        carrierParent.position = position;

        if (this.syncCharacterRigidbodies.has(sessionId)) {
            // 나갈 땐 다시 velocity를 초기화
            this.syncCharacterRigidbodies.get(sessionId).velocity = Vector3.zero;
            this.syncCharacterRigidbodies.delete(sessionId);
        }
    }

    /* HasPlayerInCarrierPool()
       - Check if a specific character is on a block.
    */
    public HasPlayerInCarrierPool(sessionId: string): boolean {

        if (this.syncCharacterRigidbodies.has(sessionId)) {
            return true;
        } else {
            return false;
        }
    }

    /* SetIsCharacterLandedOnBlock()
       - Called when a character lands on a block.
    */
    private isLocalCharacterLanded: boolean = false;
    public SetIsCharacterLandedOnBlock() {
        this.isLocalCharacterLanded = true;
    }

    /* SetBlockIdx()
        - Sets the index of the current block to synchronize the position of the character on the block in multiplayer.
    */
    public SetBlockIdx(idx: number) {
        this.myIdx = idx;

    }
}