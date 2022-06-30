import { CharacterController, Collider, Mathf, Quaternion, Rigidbody, Time, Vector3, } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'

export default class MovingBlock extends ZepetoScriptBehaviour {

    @Header("Move Block")
    public rigidbody: Rigidbody;
    public moveSpeed: Vector3;
    public timeToMove: number = 1;

    private moveDirection: int;

    private isLocalPlayerOnBlock: boolean = false;
    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    @Header("Rotate Block (Option)")
    public isBlockRotating: boolean;
    public eulerAngleVelocity: Vector3;

    public characterRotateAroundSpeed: number = -1;

    private prevDirection: number = 0;
    private clientElapsedTime: number = 0;

    private Start() {

        this.moveDirection = 1;
        this.prevDirection = -1;

        this.rigidbody.useGravity = false;
        this.rigidbody.isKinematic = false;
        this.rigidbody.freezeRotation = true;
        this.rigidbody.velocity = this.moveSpeed * this.moveDirection;

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
    }

    private FixedUpdate() {
        this.clientElapsedTime += Time.fixedDeltaTime;

        // Move the block relative to the current elapsed time. 
        this.MoveBlock(this.clientElapsedTime);

        this.MoveLocalCharacterWithBlock();
        if (false == this.isBlockRotating)
            return;

        // Block/Character rotations.
        this.RotateBlock();
        this.RotateCharacterWithBlock();
    }

    private OnTriggerEnter(coll: Collider) {
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = true;
    }

    private OnTriggerExit(coll: Collider) {
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = false;
    }

    /* MoveBlock() 
       - Controls the block direction/speed. 
    */
    private MoveBlock(elapsedTime: number) {

        let predictedDir: number = (Mathf.Floor(elapsedTime / this.timeToMove)) % 2 == 0 ? 1 : -1;

        // Continuously apply the direction to the predicted direction
        this.moveDirection = predictedDir;

        // Reapply velocity only ff the current direction is different than the previous direction
        if (this.moveDirection != this.prevDirection) {
            // Reapply block speed.
            this.rigidbody.velocity = this.moveSpeed * this.moveDirection;
        }

        this.prevDirection = this.moveDirection;
    }

    /* MoveCharacterWithBlock() 
       - Move the local character with the block. 
    */
    private MoveLocalCharacterWithBlock() {
        if (false == this.isLocalPlayerOnBlock)
            return;

        let velocity = this.moveSpeed * this.moveDirection;

        this.localCharacterController.Move(velocity * Time.fixedDeltaTime);
    }

    /* RotateBlock() 
        - Rotate block if the rotation option is enabled. 
    */
    private RotateBlock() {
        let deltaRotation: Quaternion = Quaternion.Euler(this.eulerAngleVelocity * Time.fixedDeltaTime);
        this.rigidbody.MoveRotation(this.rigidbody.rotation * deltaRotation);
    }

    /* RotateCharacterWithBlock() 
       - If the block rotation is enabled, rotate the character along with the block. 
    */
    private RotateCharacterWithBlock() {
        // Local character rotation
        if (this.isLocalPlayerOnBlock) {
            this.localCharacter.transform.RotateAround(this.transform.position, Vector3.down, this.characterRotateAroundSpeed);
        }
    }
}