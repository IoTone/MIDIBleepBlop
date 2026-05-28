import {validate} from "SpectaclesInteractionKit.lspkg/Utils/validate";
import {ToggleButton} from "SpectaclesInteractionKit.lspkg/Components/UI/ToggleButton/ToggleButton";
import { KeyboardChannelMode } from "./ProjectScripts/KeyboardChannelMode";

@component
export class NewScript extends BaseScriptComponent {
    @input textInputURL: Text;
    @input editButtonToggle: ToggleButton;
    @input keyboardMode!: KeyboardChannelMode;
    private foo = "123";
    private options: TextInputSystem.KeyboardOptions | null = null;
    
    async onAwake() {
        print("onAwake");        

        try {
        let textInputModule = require("LensStudio:TextInputModule");
        
        this.createEvent("OnStartEvent").bind(() => {
          /*
            print("value is: " + this.textInputURL.text);
            this.options = new TextInputSystem.KeyboardOptions();
            this.options.enablePreview = true;
            this.options.keyboardType = TextInputSystem.KeyboardType.Text;
            this.options.returnKeyType = TextInputSystem.ReturnKeyType.Return;
            // Maintain the state of the keyboard
            let urldata = this.textInputURL.text;
            
            // this.options.onTextChanged = function(text, range) {
            this.options.onTextChanged = (text: string, range: vec2) => {
                this.textInputURL.text = text;
                print("text changed: " + text);
            };
            // When the keyboard returns, print the current text
            this.options.onKeyboardStateChanged = (isOpen: boolean) => {
                if (!isOpen) {
                    print("closed keyboard with done " + this.textInputURL.text);
                }
            };
            this.options.onError = (error: number, description: string) => {
                // print("error oops");    
                print(`Keyboard error: ${error} - ${description}`);
            };
            this.options.initialText = this.textInputURL.text;
            
            // let socket: WebSocket = internetModule.createWebSocket('wss://s14730.blr1.piesocket.com/v3/1?api_key=JdhmYJpiMdMk2bTiyvF0PUj2GMZegocR2ANdtglt&notify_self=1');
            // let socket: WebSocket = internetModule.createWebSocket('wss://s14730.blr1.piesocket.com/v3/1?api_key=JdhmYJpiMdMk2bTiyvF0PUj2GMZegocR2ANdtglt&notify_self=1');
            */
            this.editButtonToggle.onStateChanged.add(
                (isToggledOn: boolean) => {
                if (isToggledOn) {
                    print("toggleOn");
                    // where you currently call: global.textInputSystem.requestKeyboard(...)
                    this.keyboardMode.open();
                    // global.textInputSystem.requestKeyboard(this.options);
                } else {
                    print("toggleOff");
                    // global.textInputSystem.dismissKeyboard();
                    this.keyboardMode.close();
                }
            });
        });

        /*
        // In whatever script currently calls
  global.textInputSystem.requestKeyboard/dismissKeyboard:
  @input keyboardMode!: KeyboardChannelMode;     // wire to the new SceneObject

  // where you currently call: global.textInputSystem.requestKeyboard(...)
  this.keyboardMode.open();

  // where you currently call: global.textInputSystem.dismissKeyboard()
  this.keyboardMode.close();

  Both open() and close() are public. The mode component installs the right
  keyboard options (Text type, no preview UI, onTextChanged mapped to Ableton
  key map).
         */
        /*
        let internetModule = require("LensStudio:InternetModule");
        // let socket: WebSocket = internetModule.createWebSocket('ws://127.0.0.1:8080');
        // let socket: WebSocket = internetModule.createWebSocket('wss://7e674bbe28a7.ngrok.app/');
        let socket: WebSocket = internetModule.createWebSocket('ws://localhost:8091');
        
        
        
        this.createEvent("OnStartEvent").bind(() => {
            print("value is: " + this.textInputURL.text);
            this.options = new TextInputSystem.KeyboardOptions();
            this.options.enablePreview = true;
            this.options.keyboardType = TextInputSystem.KeyboardType.Text;
            this.options.returnKeyType = TextInputSystem.ReturnKeyType.Return;
            // Maintain the state of the keyboard
            let urldata = this.textInputURL.text;
            
            // this.options.onTextChanged = function(text, range) {
            this.options.onTextChanged = (text: string, range: vec2) => {
                this.textInputURL.text = text;
                print("text changed: " + text);
            };
            // When the keyboard returns, print the current text
            this.options.onKeyboardStateChanged = (isOpen: boolean) => {
                if (!isOpen) {
                    print("closed keyboard with done " + this.textInputURL.text);
                }
            };
            this.options.onError = (error: number, description: string) => {
                // print("error oops");    
                print(`Keyboard error: ${error} - ${description}`);
            };
            this.options.initialText = this.textInputURL.text;
            
            // let socket: WebSocket = internetModule.createWebSocket('wss://s14730.blr1.piesocket.com/v3/1?api_key=JdhmYJpiMdMk2bTiyvF0PUj2GMZegocR2ANdtglt&notify_self=1');
            // let socket: WebSocket = internetModule.createWebSocket('wss://s14730.blr1.piesocket.com/v3/1?api_key=JdhmYJpiMdMk2bTiyvF0PUj2GMZegocR2ANdtglt&notify_self=1');
            this.editButtonToggle.onStateChanged.add(
                (isToggledOn: boolean) => {
                if (isToggledOn) {
                    print("toggleOn");
                    global.textInputSystem.requestKeyboard(this.options);
                } else {
                    print("toggleOff");
                    global.textInputSystem.dismissKeyboard();
                }
            });
        });
        */
       
        /*
        socket.binaryType = 'blob';
        // Listen for the open event
        socket.onopen = (event: WebSocketEvent) => {
          // Socket has opened, send a message back to the server
          socket.send('Hello Spectacles');
                
          
    
          // Try sending a binary message
          // (the bytes below spell 'Message 2')
          const message: number[] = [77, 101, 115, 115, 97, 103, 101, 32, 50];
          const bytes = new Uint8Array(message);
          socket.send(bytes);
          
           print("Socket opened");
        };
    
        // Listen for messages
        socket.onmessage = async (event: WebSocketMessageEvent) => {
          if (event.data instanceof Blob) {
            // Binary frame, can be retrieved as either Uint8Array or string
            const bytes = await event.data.bytes();
            const text = await event.data.text();
    
            print('Received binary message, printing as text: ' + text);
            // Ignore these binary messages for now
          } else {
            // Text frame
            const text: string = event.data;
            print('Received text message: ' + text);
            
            
          }
        };
        socket.onclose = (event: WebSocketCloseEvent) => {
          print("onClose");
          
          if (event.wasClean) {
            print('Socket closed cleanly');
          } else {
            print('Socket closed with error, code: ' + event.code);
          } 
        };
    
        socket.onerror = (event: WebSocketEvent) => {

            
            try {  
                print('Socket error');            
            }
            catch (e: unknown) { //  note `e` has explicit `unknown` type
            }
            
        };
        
        */
        } catch(e) {
            print(e); 
        }
      
    }
    
}
