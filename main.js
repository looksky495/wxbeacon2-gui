const Noble = require("@stoprocent/noble");
const Path = require("path");
const { app, BrowserWindow, ipcMain, Menu, Notification } = require('electron');
const Prompt = require("electron-prompt");

var mainWindow = null;
var historyWindow = null;
var viewerLabel = "EnvSensor";
var isPowerLowNotified = false;
const isMac = (process.platform === 'darwin');

class WxBeacon2 {
  /** @type {Noble.Peripheral | null} */
  #device = null;

  #UID = {
    SERVICE_SENSOR: "0c4c3000770046f4aa96d5e974e32a54",
    CHARACTERISTIC_LATEST_DATA: "0c4c3001770046f4aa96d5e974e32a54",
    SERVICE_SENSOR_SETTING: "0c4c3010770046f4aa96d5e974e32a54",
    CHARACTERISTIC_MEASUREMENT_INTERVAL: "0c4c3011770046f4aa96d5e974e32a54",
    SERVICE_CONTROL: "0c4c3030770046f4aa96d5e974e32a54",
    CHARACTERISTIC_TIME_INFORMATION: "0c4c3030770046f4aa96d5e974e32a54",
  }

  wxData = {};
  wxHistory = [];
  onConnectionError = null;
  onDiscover = null;
  onReceiveWxData = null;

  constructor (){}
  startStanning (){
    Noble.on("stateChange", async state => {
      if (state === "poweredOn") {
        await Noble.startScanningAsync();
      } else {
        await Noble.stopScanningAsync();
      }
    });
    Noble.on("discover", async peripheral => {
      // const localName = peripheral.advertisement.localName;
      console.log(peripheral.advertisement, peripheral.rssi);
      if (peripheral.advertisement.localName === "Env" && peripheral.connectable){
        await Noble.stopScanningAsync();
        try {
          await peripheral.connectAsync();
          console.log("接続を開始");
          this.#device = peripheral;
          isPowerLowNotified = false;
          this.onDiscover?.();
        } catch (e){
          console.error(peripheral.uuid + " への接続に失敗");
          this.onConnectionError?.();
        }
      }
    });
  }

  /** Notifyを登録 */
  async startWxObservationAsync (){
    await this.registerNotificationAsync(await this.getCharacteristicsAsync(this.#UID.SERVICE_SENSOR, this.#UID.CHARACTERISTIC_LATEST_DATA));
  }

  /** このデータはonReceiveWxDataにも返り値にも返ってくる */
  async getLatestDataAsync (){
    if (this.#device === null) return;
    this.wxData = this.parseWxData(await this.readCharacteristicsAsync(await this.getCharacteristicsAsync(this.#UID.SERVICE_SENSOR, this.#UID.CHARACTERISTIC_LATEST_DATA)));
    this.onReceiveWxData?.(this.wxData);
    return this.wxData;
  }

  /**
   * @param {String} service_uuid
   * @param {String} characteristics_uuid
   * @returns {Promise<Noble.Characteristic | undefined>}
   */
  async getCharacteristicsAsync (service_uuid, characteristic_uuid){
    if (this.#device === null) return;
    const services = await this.#device.discoverServicesAsync();
    for (const service of services){
      if (service.uuid !== service_uuid) continue;
      const characteristics = await service.discoverCharacteristicsAsync();
      return characteristics.find(c => c.uuid === characteristic_uuid);
    }
    console.error("[readCharacteristicsAsync] Failed");
    return;
  }

  /**
   * @param {Noble.Characteristic} characteristic
   * @returns {Promise<Buffer | undefined>}
   */
  async readCharacteristicsAsync (characteristic){
    if (this.#device === null) return;
    return characteristic.readAsync();
  }

  /**
   * @param {Noble.Characteristic} characteristic
   * @returns
   */
  async registerNotificationAsync (characteristic){
    if (this.#device === null) return;
    characteristic.on("data", data => {
      this.onReceiveWxData(this.wxData = this.parseWxData(data));
      this.wxHistory.push({ ...this.wxData, time: Date.now() });
      if (this.wxData.battery < 2.5 && !isPowerLowNotified){
        new Notification({
          title: "WxBeacon2 バッテリー残量低下",
          subtitle: "接続中のWxBeacon2はバッテリー残量が低下しています。電池の交換をお勧めします。"
        }).show();
        isPowerLowNotified = true;
      }
    });
    return await characteristic.notifyAsync(true);
  }

  /** @param {Buffer | null} buffer  */
  parseWxData (buffer){
    if (!buffer) return null;
    // console.log(buffer);
    const serial = buffer.readInt8(0);
    const temperature = buffer.readInt16LE(1) * 0.01;
    const humidity = buffer.readInt16LE(3) * 0.01;
    const illuminance = buffer.readUint16LE(5);
    const uvIndex = buffer.readInt16LE(7) * 0.01;
    const pressure = buffer.readInt16LE(9) * 0.1;
    const noise = buffer.readInt16LE(11) * 0.01;
    const discomfrontIndex = buffer.readInt16LE(13) * 0.01;
    const wbgt = buffer.readInt16LE(15) * 0.01;
    const battery = buffer.readUint16LE(17) * 0.001;
    return { serial, temperature, humidity, illuminance, uvIndex, pressure, noise, discomfrontIndex, wbgt, battery };
  }

  async disconnect(){
    if (this.#device === null) return;
    await this.#device.disconnectAsync();
    console.log("接続を終了");
  }
}

const MenuJSON = [
  ...(isMac ? [{
    label: app.name,
    submenu: [
      {role:'about',      label:`${app.name}について` },
      {type:'separator'},
      {role:'services',   label:'サービス'},
      {type:'separator'},
      {role:'hide',       label:`${app.name}を隠す`},
      {role:'hideothers', label:'ほかを隠す'},
      {role:'unhide',     label:'すべて表示'},
      {type:'separator'},
      {role:'quit',       label:`${app.name}を終了`}
    ]
  }] : []),
  {
    label: '表示',
    submenu: [
      {role:'reload',         label:'再読み込み'},
      {role:'forceReload',    label:'強制的に再読み込み'},
      {role:'toggleDevTools', label:'開発者ツールを表示'},
      {type:'separator'},
      {
        label: 'ラベルを変更',
        CmdOrCtrl: 'Ctrl+T',
        click: () => {
          Prompt({
            title: "ラベルを変更",
            value: viewerLabel,
            label: "",
            type: "input",
            inputAttrs: { type: "text", required: true }
          }).then(result => {
            if (result !== null){
              viewerLabel = result;
              if (mainWindow) mainWindow.webContents.send("changelabel", result);
            }
          }).catch(console.error);
        }
      }
    ]
  },
  {
    label: 'ウィンドウ',
    submenu: [
      {role:'minimize', label:'最小化'},
      {role:'zoom',     label:'ズーム'},
      {type:'separator'},
      {
        label: '常に前面に表示する',
        type: 'checkbox',
        checked: true,
        accelerator: 'Option+T',
        click: function(e) { mainWindow.setAlwaysOnTop(e.checked); }
      },
      {
        label: '履歴を表示',
        accelerator: 'Ctrl+H',
        click: () => { if (!historyWindow) createLogWindow(); }
      },
      {type:'separator'},
      {role:'close',  label:'閉じる'}
    ]
  }
];
const MenuTemplate = Menu.buildFromTemplate(MenuJSON);
Menu.setApplicationMenu(MenuTemplate);

function readBeaconData (){
  const beacon = new WxBeacon2();
  beacon.onReceiveWxData = async (data) => {
    // console.log(new Date());
    // console.log(data);
    if (mainWindow) mainWindow.webContents.send("wxdata", data);
  };
  beacon.onDiscover = async () => {
    await beacon.getLatestDataAsync();
    await beacon.startWxObservationAsync();
  };
  beacon.startStanning();
  return beacon;
};

const beacon = readBeaconData();

app.on("ready", () => {
  mainWindow = new BrowserWindow({
    width: 130,
    height: 289,
    useContentSize: true,
    title: "WxBeacon2 Viewer",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: Path.join(__dirname, "./ipc.js")
    },
    frame: false,
    backgroundColor: "#00000000",
    transparent: true,
    alwaysOnTop: true,
    resizable: false
  });
  mainWindow.on('closed', function() {
    app.quit();
  });
  mainWindow.loadFile("./viewer.html");
});

function createLogWindow (){
  historyWindow = new BrowserWindow({
    width: 890,
    height: 492,
    useContentSize: true,
    title: "WxBeacon2 History",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: Path.join(__dirname, "./ipc.js")
    }
  });
  historyWindow.on('closed', () => {
    historyWindow = null;
  });
  historyWindow.loadFile("./history.html");
}

ipcMain.handle("getLatestWxData", () => {
  return beacon.wxData;
});
ipcMain.handle("getLabelName", () => {
  return viewerLabel;
});
ipcMain.handle("getWxHistory", () => {
  return beacon.wxHistory;
});
ipcMain.handle("clearHistory", () => {
  beacon.wxHistory = [];
});
