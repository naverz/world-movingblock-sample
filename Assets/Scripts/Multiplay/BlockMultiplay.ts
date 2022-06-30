import { Coroutine, GameObject, RuntimeAnimatorController, Mathf, Quaternion, Transform, Vector3, WaitForSeconds, Time, YieldInstruction, Rigidbody, AnimationClip } from 'UnityEngine';
import { Text } from 'UnityEngine.UI';
import { Room, RoomData } from 'ZEPETO.Multiplay';
import { ZepetoScriptBehaviour } from 'ZEPETO.Script'
import { ZepetoWorldMultiplay } from 'ZEPETO.World';
import { Player, State } from 'ZEPETO.Multiplay.Schema';
import { CharacterState, ZepetoPlayers } from 'ZEPETO.Character.Controller';
import CharacterEventChecker from './CharacterEventChecker';
import CarrierParentController from './CarrierParentController';
import MultiMovingBlock from './MultiMovingBlock';
import MultiOrbitingBlock from './MultiOrbitingBlock';
/**
 * Interface
 * 
 * PlayerBlockInfo
 *  Character position relatative to the block its standing on
 * 
 * PlayerPlatformInfo
 * Whent the stands on a platform, the block relative positioning and the position at the start of a jump.
 * 
 * PlayerTimestamp
 *  Timestamps for game start as well as join time. 
*/

interface PlayerBlockInfo {
    sessionId: string,
    blockIndex: number,
    relativeX: number,
    relativeY: number,
    relativeZ: number
}

interface PlayerPlatformInfo {
    sessionId: string,
    relativeX: number,
    relativeY: number,
    relativeZ: number,
    posX: number,
    posY: number,
    posZ: number
}

interface PlayerTimestamp {
    gameStartTimestamp: number,
    playerJoinTimestamp: number;
}

export default class BlockMultiplay extends ZepetoScriptBehaviour {

    public multiplay: ZepetoWorldMultiplay;
    private room: Room;

    public movingBlocks: GameObject[];
    public orbitingBlocks: GameObject[];

    private movingBlockScripts: MultiMovingBlock[];
    private orbitingBlockScripts: MultiOrbitingBlock[];

    // Current block index
    private blockIdx: number = 0;

    // Varaibles required for character position synchronization during multiplay. 
    public carrierParentPrefab: GameObject; //Transport parent prefab. 
    private originCharacterParents: Map<string, GameObject> = new Map<string, GameObject>();
    private characterContexts: Map<string, GameObject> = new Map<string, GameObject>();
    private carrierParents: Map<string, GameObject> = new Map<string, GameObject>();

    // Variable required for block movement. 
    private gameStartTimestampFromServer: number = 0;
    private diffTimestamp: number = 0;

    // Character respawn point on map. 
    public respawnPoint: Transform;

    // If the game has been paused via app background mode. 
    private bPaused: boolean = false;

    // Movement/Animation variables required on character jump event
    public moveBlockAnimator: RuntimeAnimatorController;
    private isLanding: Map<string, boolean> = new Map<string, boolean>();
    private playerTargetPosition: Map<string, Vector3> = new Map<string, Vector3>();
    private jumpCoroutines: Map<string, Coroutine> = new Map<string, Coroutine>();
    private changeTargetPositionCoroutines: Map<string, Coroutine> = new Map<string, Coroutine>();
    private playerJumpDistances: Map<string, number> = new Map<string, number>();
    private playerFlightDuration: Map<string, number> = new Map<string, number>();
    private playerJumpDistance: number = 3;
    private waitForChangeTargetSeconds: YieldInstruction = new WaitForSeconds(0.1);
    private isLandingPlatform: Map<string, boolean> = new Map<string, boolean>();

    private static Instance: BlockMultiplay;
    /* Singleton */
    public static GetInstance(): BlockMultiplay {
        if (!BlockMultiplay.Instance) {
            const targetObj = GameObject.Find("BlockMultiplay");
            if (targetObj)
                BlockMultiplay.Instance = targetObj.GetComponent<BlockMultiplay>();
        }
        return BlockMultiplay.Instance;
    }

    private MESSAGE_TYPE_ServerTimestamp = "ServerTimestamp";
    private MESSAGE_TYPE_OnBlockTriggerEnter = "OnBlockTriggerEnter";
    private MESSAGE_TYPE_OnCharacterLandedBlock = "OnCharacterLandedBlock";
    private MESSAGE_TYPE_OnCharacterJumpOnBlock = "OnCharacterJumpOnBlock";
    private MESSAGE_TYPE_OnTryJump = "OnTryJump";
    private MESSAGE_TYPE_OnPlatformState = "OnPlatformState";
    private MESSAGE_TYPE_OnFallTriggerEnter = "OnFallTriggerEnter";
    private MESSAGE_TYPE_OnTryJumpForMovingToBlock = "OnTryJumpForMovingToBlock";
    private MESSAGE_TYPE_OnLeavePlayer = "OnLeavePlayer";

    private Start() {

        this.bPaused = false;
        this.blockIdx = 0;

        this.movingBlockScripts = new Array<MultiMovingBlock>(this.movingBlocks.length);
        this.orbitingBlockScripts = new Array<MultiOrbitingBlock>(this.orbitingBlocks.length);

        for (let i = 0; i < this.movingBlocks.length; i++) {
            this.movingBlockScripts[i] = this.movingBlocks[i].GetComponent<MultiMovingBlock>();
            this.movingBlockScripts[i].SetBlockIdx(this.blockIdx++);
        }

        for (let i = 0; i < this.orbitingBlocks.length; i++) {
            this.orbitingBlockScripts[i] = this.orbitingBlocks[i].GetComponent<MultiOrbitingBlock>();
            this.orbitingBlockScripts[i].SetBlockIdx(this.blockIdx++);
        }

        this.multiplay.RoomCreated += (room: Room) => {
            this.room = room;
            this.AddMessageHandlersForBlockSync();
            this.AddMessageHandlersForCharacterSync();
        };

        // Add local character - block collision event. 
        ZepetoPlayers.instance.OnAddedLocalPlayer.AddListener(() => {
            ZepetoPlayers.instance.LocalPlayer.zepetoPlayer.character.gameObject.AddComponent<CharacterEventChecker>();
        });
    }

    private OnApplicationPause(pause: boolean) {
        // If returning from background pause, update block positioning. 
        if (pause) {
            this.bPaused = true;
        } else {
            if (this.bPaused) {
                this.bPaused = false;
                // current timestamp 
                let curClientTimestamp = + new Date();

                // elapsed time = - current timestamp - (game start time + difference) // ex. 3Months 6Days 30Seconds - (3Months 1Day + 5Days)
                let elapsedTime = curClientTimestamp - (this.gameStartTimestampFromServer + this.diffTimestamp);

                // Convert to seconds for block movement. 
                let timestampSecond = elapsedTime / 1000;

                // Update the passed time to each moving block to their corresponding rooms. 
                for (let i = 0; i < this.movingBlockScripts.length; i++) {
                    this.movingBlockScripts[i].InitMultiplayMode(timestampSecond);
                }
                // Update the passed time to each orbiting block to their corresponding rooms. 
                for (let i = 0; i < this.orbitingBlockScripts.length; i++) {
                    this.orbitingBlockScripts[i].InitMultiplayMode(timestampSecond);
                }
            }
        }
    }

    /* AddMessageHandlersForBlockSync()
       - Message Handlers for block position sync. 
    */
    private AddMessageHandlersForBlockSync() {

        // When first joining the server 처음 서버에 Join 시 게임시작 timestamp와 플레이어 접속시점 timestamp를 전달 받습니다.
        this.room.AddMessageHandler(this.MESSAGE_TYPE_ServerTimestamp, (message: PlayerTimestamp) => {

            let timestampInfo: PlayerTimestamp = {
                gameStartTimestamp: message.gameStartTimestamp,
                playerJoinTimestamp: message.playerJoinTimestamp
            };

            // Cache the server's game start time. 
            this.gameStartTimestampFromServer = Number(timestampInfo.gameStartTimestamp);

            // Catche the player join time from the server. 
            let playerJoinTimestampFromServer = Number(timestampInfo.playerJoinTimestamp);

            // Current client time. 
            let curClientTimeStamp = + new Date();

            // Save the difference between the server timestamp and the client timestamp. 
            // - For applying the difference after returning from the background. 
            let diff: number = curClientTimeStamp - playerJoinTimestampFromServer;
            this.diffTimestamp = diff; // save the time difference. 

            // Elapsed time since game start. 
            let elapsedTime = playerJoinTimestampFromServer - this.gameStartTimestampFromServer;

            // Convert to seconds for block movement calculation. 
            let timestampSecond = elapsedTime / 1000;

            // Send the elapsed time to each block. 
            for (let i = 0; i < this.movingBlockScripts.length; i++) {
                this.movingBlockScripts[i].InitMultiplayMode(timestampSecond);
            }

            for (let i = 0; i < this.orbitingBlockScripts.length; i++) {
                this.orbitingBlockScripts[i].InitMultiplayMode(timestampSecond);
            }
        });
    }

    /* AddMessageHandlersForCharacterSync()
       - Message handlers for Character position syncing
       MESSAGE_TYPE_OnPlatformState : When the character lands on a platform. 
       MESSAGE_TYPE_OnTryJumpForMovingToBlock : When the character initiates movement from platform to block. 
       MESSAGE_TYPE_OnCharacterLandedBlock : When the character lands on a moving block
       MESSAGE_TYPE_OnCharacterJumpOnBlock : When the character jump on a block
       MESSAGE_TYPE_OnFallTriggerEnter : When the character falls into a falltrigger.
       MESSAGE_TYPE_OnLeavePlayer : When the character leaves the room. 
    */
    private AddMessageHandlersForCharacterSync() {

        // When the character lands from moving block to platform, assign transport parent to original parent. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnPlatformState, (message: string) => {
            // Return the context to original parent for running Base synchronization logic
            const sessionId: string = message.toString();
            if (false == this.characterContexts.has(sessionId)) {
                return;
            }
            this.ResetOriginParent(sessionId);
            this.ResetJumpToBlockSetting(sessionId);
        });

        // When the character attemps to land on a moving block from a platform. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnTryJumpForMovingToBlock, (message: PlayerPlatformInfo) => {
            const relativeVector = new Vector3(message.posX, message.posY, message.posZ);
            const platformPosition = new Vector3(message.relativeX, message.relativeY, message.relativeZ);
            const sessionId: string = message.sessionId;
            this.SetCarrierParentAndZepetoContext(sessionId);
            //When the character moves from platform to moving block, send -1 as the index and send the jump position. 
            this.SetJumpToBlockSetting(sessionId, -1, relativeVector, this.FIRSTBLOCK, platformPosition);
        });

        // When the character lands on the block send the relative position vector as a message. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnCharacterLandedBlock, (message: PlayerBlockInfo) => {
            // 해당 캐릭터를 블록 위로 텔레포트
            this.TeleportCharacterOnBlock(message);
        });

        // When the character jumps from a block, send the relative position vector as a message. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnCharacterJumpOnBlock, (message: PlayerBlockInfo) => {
            this.OnBlockTriggerExit(message);
        });

        // Send a message for when the characte ralls off the block. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnFallTriggerEnter, (message: string) => {
            const sessionId: string = message.toString();
            this.ResetJumpToBlockSetting(sessionId);
            // Character respawn. 
            if (this.carrierParents.has(sessionId)) {
                this.StartCoroutine(this.RespwanCharacter(sessionId));
            }
        });

        // Recieve a message when the player leaves the room. 
        this.room.AddMessageHandler(this.MESSAGE_TYPE_OnLeavePlayer, (message: string) => {
            const sessionId: string = message.toString();
            // Destroy the inspectors used by the player. 
            if (this.carrierParents.has(sessionId)) {
                this.carrierParents.delete(sessionId);
            }
            if (this.characterContexts.has(sessionId)) {
                this.characterContexts.delete(sessionId);
            }
            if (this.originCharacterParents.has(sessionId)) {
                this.originCharacterParents.delete(sessionId);
            }
        });
    }

    /*
        When the character falls, respawn the character at the respawn point. 
    */
    private *RespwanCharacter(sessionId: string) {
        const carrierParent = this.carrierParents.get(sessionId);
        while (carrierParent.transform.position != this.respawnPoint.position) {
            carrierParent.transform.position = this.respawnPoint.position;
            yield null;
        }
    }

    // ------------------------ Funcions Necessary for sending messages to the server ------------------------
    /* SendOnTryJumpForMovingToBlock()
       - When the character attemps a move from a platform to a moving block.
    */
    public SendOnTryJumpForMovingToBlock(position: Vector3, platformPosition: Vector3) {
        const data = new RoomData();
        const relativePos = new RoomData();
        const platformPos = new RoomData();

        relativePos.Add("x", position.x);
        relativePos.Add("y", position.y);
        relativePos.Add("z", position.z);
        data.Add("relativePos", relativePos.GetObject());

        platformPos.Add("x", platformPosition.x);
        platformPos.Add("y", platformPosition.y);
        platformPos.Add("z", platformPosition.z);
        data.Add("platformPos", platformPos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnTryJumpForMovingToBlock, data.GetObject());
    }

    /* SendOnBlockTriggerEnter() 
       - When the enters a moving block trigger. 
    */
    public SendOnBlockTriggerEnter(blockIdx: number) {
        this.room.Send(this.MESSAGE_TYPE_OnBlockTriggerEnter, blockIdx);
    }

    /* SendOnBlockTriggerExit() 
       - When the player exits a moving block trigger. 
    */
    public SendOnBlockTriggerExit(blockIdx: number, relativePosition: Vector3) {
        const data = new RoomData();
        data.Add("blockIdx", blockIdx);

        const relativePos = new RoomData();
        relativePos.Add("x", relativePosition.x);
        relativePos.Add("y", relativePosition.y);
        relativePos.Add("z", relativePosition.z);

        data.Add("relativePos", relativePos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnCharacterJumpOnBlock, data.GetObject());
    }

    /* SendOnLandedBlock() 
       - Send relative position vectors when the local player lands on a block.
    */
    public SendOnLandedBlock(blockIdx: number, relativeVector: Vector3) {
        const data = new RoomData();
        data.Add("blockIdx", blockIdx);

        const relativePos = new RoomData();
        relativePos.Add("x", relativeVector.x);
        relativePos.Add("y", relativeVector.y);
        relativePos.Add("z", relativeVector.z);
        data.Add("relativePos", relativePos.GetObject());

        this.room.Send(this.MESSAGE_TYPE_OnCharacterLandedBlock, data.GetObject());
    }

    /* SendOnPlatformState() 
       - When the local character lands on a platform, send the relative position as a vector.
    */
    public SendOnPlatformState() {
        this.room.Send(this.MESSAGE_TYPE_OnPlatformState);
    }

    /* SendOnFallTriggerEnter() 
       - When the local character falls, send a message to the server. 
    */
    public SendOnFallTriggerEnter() {
        this.room.Send(this.MESSAGE_TYPE_OnFallTriggerEnter);
    }

    /* SendTryJump() 
       - Whent he local character jumps from a block. 
    */
    public SendTryJump(isJumping: boolean) {
        this.room.Send(this.MESSAGE_TYPE_OnTryJump, isJumping);
    }

    /* CheckPlayerOnBlock()
       - Setup code for if a character in a room is already on a block
    */
    public CheckPlayerOnBlock(sessionId: string) {

        let player: Player = this.room.State.players.get_Item(sessionId);
        let serverBlockIndex = player.blockIndex;
        if (player.isOnBlock) {
            // In the case of a moving block. 
            if (this.IsMovingBlock(serverBlockIndex)) {
                // Check if a character is in the target block
                if (false == this.movingBlockScripts[serverBlockIndex].HasPlayerInCarrierPool(sessionId)) {
                    // If none, create transport parent and initialize. 
                    this.SetCarrierParentAndZepetoContext(sessionId);

                    let relativeVector: Vector3 = Vector3.zero;
                    let carrierParent: Transform = this.carrierParents.get(sessionId).transform;
                    // Assign the block as the destination block. 
                    this.movingBlockScripts[serverBlockIndex].AddCharacterOnBlock(sessionId, relativeVector, carrierParent);
                }
            }
            // In the case of an orbiting block.
            else {
                let newIndex = this.GetBlockIndex(serverBlockIndex);
                // Check if a character is in the target block
                if (false == this.orbitingBlockScripts[newIndex].HasPlayerInCarrierPool(sessionId)) {
                    // If none, create transport parent and initialize. 
                    this.SetCarrierParentAndZepetoContext(sessionId);

                    let relativeVector: Vector3 = Vector3.zero;
                    let carrierParent: Transform = this.carrierParents.get(sessionId).transform;
                    // Assign the block as the destination block. 
                    this.orbitingBlockScripts[newIndex].AddCharacterOnBlock(sessionId, relativeVector, carrierParent);

                }
            }
        }
    }

    /* ResetOriginParent() 
       - Revert the carrierParent as the Zepeto Character parent.
    */
    private ResetOriginParent(sessionId: string) {
        const context = this.characterContexts.get(sessionId);
        const originParent = this.originCharacterParents.get(sessionId);
        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;

        originParent.transform.position = this.carrierParents.get(sessionId).transform.position;
        originParent.transform.rotation = this.carrierParents.get(sessionId).transform.rotation;

        context.transform.SetParent(originParent.transform);
        context.transform.localPosition = Vector3.zero;
        context.transform.localEulerAngles = Vector3.zero;

        originParent.SetActive(true);

        /**
         * If there is no input at the moment of changing from carrierParent to originParent, the base state is executed, and there is an issue where the character lands on the platform in JumpMove, Run, etc. and then jumps.
         * TODO : In order to forcibly change the state, start a random gesture and cancel the gesture after a fixed amount of time. If there is no input for 0.2 seconds, apply the same logic as above if the gesture can be reset. 
         * */
        if (character.CurrentState == CharacterState.JumpMove || character.CurrentState == CharacterState.Run)
            this.StartCoroutine(this.CancelGestureCorutine(sessionId));
    }

    private *CancelGestureCorutine(sessionId: string) {

        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;
        character.SetGesture(this.gesture);
        yield new WaitForSeconds(0.2);
        while (character.CurrentState == CharacterState.Gesture) {
            character.CancelGesture();
            yield null;
        }
    }

    public gesture: AnimationClip;

    /* SetCarrierParentAndZepetoContext() 
       - To move between blocks, take the Zepeto Context under the current character and attach it to the carrierParent.
    */
    private SetCarrierParentAndZepetoContext(sessionId: string) {

        // Instantiate transport parent if it doesn't exist. 
        if (false == this.carrierParents.has(sessionId)) {
            var obj = GameObject.Instantiate<GameObject>(this.carrierParentPrefab);
            obj.GetComponent<CarrierParentController>().SetSessionId(sessionId);
            obj.name = `CarrierParent_${sessionId}`;
            this.carrierParents.set(sessionId, obj);
        }

        //Initialize gravity usage.
        this.carrierParents.get(sessionId).GetComponent<Rigidbody>().useGravity = false;

        // Grab the carrierParent if it exists.
        let carrierParent = this.carrierParents.get(sessionId);
        const character = ZepetoPlayers.instance.GetPlayer(sessionId).character;

        // There are cases where the carrierParent is in an odd position. Reset to charact transform position.
        carrierParent.transform.position = character.transform.position;
        carrierParent.transform.rotation = character.transform.rotation;

        // After grabbing the context, cache it to the Map to revert it later.
        const context = character.Context.gameObject;
        this.characterContexts.set(sessionId, context);

        // Set new carrierParent in context and initialize angle and position
        context.transform.SetParent(carrierParent.transform);
        context.transform.localEulerAngles = Vector3.zero;
        context.transform.localPosition = Vector3.zero;

        // Save the original parent to the map for later use. 
        this.originCharacterParents.set(sessionId, character.gameObject);
        character.gameObject.SetActive(false); // Deactivate
    }

    /* GetBlockIndex() 
       - Return the index depending on whether the block is moving or orbiting.
    */
    private GetBlockIndex(idx: number): number {
        if (idx < this.movingBlocks.length) {
            return idx;
        } else {
            return idx - this.movingBlocks.length;
        }
    }

    /* TeleportBlockRelativePosition() 
        - Moves the remote character to the relative position of the target block, and registers the character as a transport target to the block.
          The remote character registered in the transport target moves with the moving block.  
    */
    TeleportCharacterOnBlock(message: PlayerBlockInfo) {
        const sessionId: string = message.sessionId;

        // Jump related handling
        if (this.carrierParents.has(sessionId)) {
            const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
            animator.runtimeAnimatorController = this.moveBlockAnimator;
            animator.enabled = true;
            animator.SetBool("JumpMove", false);
        }

        // Stop the jump coroutine if in landing state
        this.StopJumpToBlockCoroutine(sessionId);

        const blockIdx: number = message.blockIndex;
        const relativePos = new Vector3(message.relativeX, message.relativeY, message.relativeZ);

        let carrierParent = this.carrierParents.get(sessionId);
        if (this.IsMovingBlock(blockIdx)) {
            let blockIndex = this.GetBlockIndex(blockIdx);
            this.movingBlockScripts[blockIndex].AddCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
        } else {
            let blockIndex = this.GetBlockIndex(blockIdx);
            this.orbitingBlockScripts[blockIndex].AddCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
        }
    }


    private MOVINGBLOCK: number = 0;
    private ORBITINGBLOCK: number = 1;
    private FIRSTBLOCK: number = 2;

    /* TeleportSameBlockRelativePosition() 
        - Moves the remote character to the jump position within the same block, and deletes it from the carrier parent of the block.
    */
    OnBlockTriggerExit(message: PlayerBlockInfo) {

        const sessionId: string = message.sessionId;
        const blockIdx: number = message.blockIndex;
        const relativePos = new Vector3(message.relativeX, message.relativeY, message.relativeZ);

        if (false == this.carrierParents.has(sessionId))
            return;

        let carrierParent = this.carrierParents.get(sessionId);
        let blockIndex = this.GetBlockIndex(blockIdx);

        if (this.IsMovingBlock(blockIdx)) {
            this.movingBlockScripts[blockIndex].RemoveCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
            this.SetJumpToBlockSetting(sessionId, blockIndex, relativePos, this.MOVINGBLOCK);
        } else {
            this.orbitingBlockScripts[blockIndex].RemoveCharacterOnBlock(sessionId, relativePos, carrierParent.transform);
            this.SetJumpToBlockSetting(sessionId, blockIndex, relativePos, this.ORBITINGBLOCK);
        }

    }

    /*IsMovingBlock()
        -  Returns whether the current block is a moving block or not via block index.
    */
    private IsMovingBlock(blockIdx: number): boolean {
        if (blockIdx < this.movingBlocks.length) {
            return true;
        } else {
            return false;
        }
    }

    /*MoveBlockToPlatform()
        - Resets to the original Zepeto Character settings the moment the player enters the platform with the carrier.
    */
    public MoveBlockToPlatform(sessionId: string) {
        // Return context to its original parent to execute synchronization logic
        if (false == this.characterContexts.has(sessionId)) {
            return;
        }
        this.isLandingPlatform.set(sessionId, true);
        this.ResetJumpToBlockSetting(sessionId);
        this.ResetOriginParent(sessionId);
    }

    public GetIsLandingPlatform(sessionId: string): boolean {
        return this.isLandingPlatform.get(sessionId);
    }

    public SetIsLandingPlatform(sessionId: string, isLandingPlatform: boolean) {
        this.isLandingPlatform.set(sessionId, isLandingPlatform);
    }


    /* ResetJumpToBlockSetting() 
        - Animators and coroutines that were altered for transport between moving blocks are returned to their original state.
    */
    private ResetJumpToBlockSetting(sessionId: string) {
        const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
        animator.runtimeAnimatorController = ZepetoPlayers.instance.characterData.animatorController;
        this.playerTargetPosition.delete(sessionId);
        this.isLanding.delete(sessionId);
        this.isLandingPlatform.delete(sessionId);
        this.playerJumpDistances.delete(sessionId);
        this.playerFlightDuration.delete(sessionId);
        this.StopJumpToBlockCoroutine(sessionId);
    }

    private SetJumpToBlockSetting(sessionId: string, blockIndex: number, relativeVector: Vector3, blockFlag: number, platformPosition?: Vector3) {
        // blockPosition is the position of the block the character was standing on, and startPosition is the position at the triggerExit point where the character exits while jumping.
        var blockPosition: Vector3 = Vector3.zero;
        var startPosition: Vector3 = Vector3.zero;

        if (blockFlag == this.FIRSTBLOCK) { // If moving from platform to block. 
            //When leaving the platform, send platformPosition to get the jump position of the platform that is not at the position of the current block, and send the previously calculated relativeVector.
            blockPosition = platformPosition ? platformPosition : relativeVector;
            startPosition = this.carrierParents.get(sessionId).transform.position;
        }
        else {
            if (blockFlag == this.MOVINGBLOCK) {
                blockPosition = this.movingBlocks[blockIndex].transform.position;
            }
            else {
                blockPosition = this.orbitingBlocks[blockIndex].transform.position;
            }
            startPosition = new Vector3(blockPosition.x - relativeVector.x, blockPosition.y - relativeVector.y, blockPosition.z - relativeVector.z);
        }

        // Jump coroutine related settings. 
        this.isLanding.set(sessionId, false);

        // Create a jump direction vector by subtracing the startPositon and the blockPosition 캐릭터의 점프 방향 구하기 - startPositon 과 blockPosition 사이 방향 벡터를 구합니다.
        var anglePos: Vector3 = (startPosition - blockPosition);

        // Character Jump Direction - If moving from platform to moving block, use the previously calulcated relativeVector
        if (blockFlag == this.FIRSTBLOCK)
            anglePos = relativeVector;

        let angle = Mathf.Atan2(anglePos.y, anglePos.x) * Mathf.Rad2Deg;
        angle = anglePos.z > 0 ? angle : angle * -1;

        // Based on the angle at which the character jumps and exits, the estimated jump position is calculated by a fixed jump length value ( playerJumpDistance : 3).
        let targetPosition = new Vector3(startPosition.x + (Mathf.Cos(angle * Mathf.Deg2Rad) * this.playerJumpDistance),
            blockPosition.y, startPosition.z + (Mathf.Sin(angle * Mathf.Deg2Rad) * this.playerJumpDistance));

        // The predicted jump position is saved for each character. 
        this.playerTargetPosition.set(sessionId, targetPosition);

        // Start the jump
        let jumpCoroutine = this.StartCoroutine(this.JumpToBlock(sessionId, startPosition, 45));
        this.jumpCoroutines.set(sessionId, jumpCoroutine);

        if (blockIndex < 0)
            return;

        if (this.carrierParents.has(sessionId)) {
            const animator = ZepetoPlayers.instance.GetPlayer(sessionId).character.ZepetoAnimator;
            animator.runtimeAnimatorController = this.moveBlockAnimator;
            animator.enabled = true;
            animator.SetBool("JumpMove", true);
        }

    }

    /**
     * JumpToBlock()
     * Parabolic function used for jumping
     * Takes the jumping character, the current jump start position, and the jump angle as parameters to jumps to the TargetPosition set in SetJumpToBlockSetting.
    */
    *JumpToBlock(sessionId: string, startPosition: Vector3, angle: number) {
        if (this.isLanding.get(sessionId))
            return;
        if (false == this.carrierParents.has(sessionId))
            return;

        //In order to make the character move in a parabola when jumping, we cache the transform of carrierParent and translate it.
        let characterTransform = this.carrierParents.get(sessionId).transform;
        let targetPosition = this.playerTargetPosition.get(sessionId);
        let distance = Vector3.Distance(targetPosition, startPosition);

        let velocity = distance / (Mathf.Sin(2 * angle * Mathf.Deg2Rad) / ZepetoPlayers.gravity);
        let x = Mathf.Sqrt(velocity) * Mathf.Cos(angle * Mathf.Deg2Rad);
        let y = Mathf.Sqrt(velocity) * Mathf.Sin(angle * Mathf.Deg2Rad);

        //Rotate the characte towards the target position.
        let rot = targetPosition - startPosition;
        characterTransform.rotation = Quaternion.LookRotation(rot);
        characterTransform.rotation = new Quaternion(0, characterTransform.rotation.y, 0, characterTransform.rotation.w);

        let flightDuration = distance / x;
        let elapseTime = 0;

        while (elapseTime < flightDuration) {
            characterTransform.Translate(0, (y - (ZepetoPlayers.gravity * elapseTime)) * Time.deltaTime, x * Time.deltaTime);
            elapseTime += Time.deltaTime;
            yield null;
        }

        //Only run if jumping onto a platform.
        if (this.isLandingPlatform.has(sessionId) && this.isLandingPlatform.get(sessionId))
            this.carrierParents.get(sessionId).GetComponent<Rigidbody>().useGravity = true;

        if (this.jumpCoroutines.has(sessionId))
            this.jumpCoroutines.delete(sessionId);
    }

    public StopJumpToBlockCoroutine(sessionId: string) {
        this.isLanding.set(sessionId, true);
        if (this.jumpCoroutines.has(sessionId)) {
            this.StopCoroutine(this.jumpCoroutines.get(sessionId));
            this.jumpCoroutines.delete(sessionId);
        }
        if (this.changeTargetPositionCoroutines.has(sessionId)) {
            this.StopCoroutine(this.changeTargetPositionCoroutines.get(sessionId));
            this.changeTargetPositionCoroutines.delete(sessionId);
        }
    }
}