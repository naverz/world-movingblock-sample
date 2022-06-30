import { CharacterController, Collider, Time, Vector3, Transform } from 'UnityEngine';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoCharacter, ZepetoPlayers } from 'ZEPETO.Character.Controller'

export default class OrbitingBlock extends ZepetoScriptBehaviour {

    // Block Rotation Variables
    @Header("Orbit Block")
    public rotSpeed: number = 0;
    public rotatingPoint: Transform;
    public characterSpeedControlValue: number = 6;

    private localCharacter: ZepetoCharacter;
    private localCharacterController: CharacterController;

    private isLocalPlayerOnBlock: boolean = false;
    private rotateAroundAxis: Vector3;

    private prevBlockPosition: Vector3 = Vector3.zero;

    private Start() {

        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            this.localCharacter = ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character;
            this.localCharacterController = this.localCharacter.GetComponent<CharacterController>();
        });

        this.isLocalPlayerOnBlock = false;
        this.rotateAroundAxis = Vector3.down;
    }

    private Update() {

        // Block Orbit
        this.transform.RotateAround(this.rotatingPoint.position, this.rotateAroundAxis, this.rotSpeed * Time.deltaTime);

        // Move Character along with the block character is standing on.
        this.MoveCharacterWithBlock();
    }

    private OnTriggerEnter(coll: Collider) {

        if (coll.gameObject == this.localCharacter.gameObject) {
            this.isLocalPlayerOnBlock = true;
        }
    }

    private OnTriggerExit(coll: Collider) {
        if (coll.gameObject != this.localCharacter.gameObject) {
            return;
        }
        this.isLocalPlayerOnBlock = false;
    }

    /* MoveCharacterWithBlock() 
       - Move the character along with the block. 
    */
    private MoveCharacterWithBlock() {

        // Create a direction vector in the blocks forward direction. 
        let curBlockPosition = this.transform.position;
        let forwardVector = (curBlockPosition - this.prevBlockPosition).normalized;
        this.prevBlockPosition = this.transform.position;

        // Move the local character. 
        if (this.isLocalPlayerOnBlock) {
            this.localCharacterController.Move(forwardVector * (this.rotSpeed / this.characterSpeedControlValue) * Time.deltaTime);
        }
    }

}