auto.waitFor();

importClass(android.view.MotionEvent);

function ensureFloatyPermission() {
  if (!floaty.checkPermission || floaty.checkPermission()) {
    return;
  }

  toast("请先开启悬浮窗权限，开启后重新打开本应用");

  try {
    floaty.requestPermission();
  } catch (e) {
    app.startActivity({
      action: "android.settings.action.MANAGE_OVERLAY_PERMISSION",
      data: "package:" + context.getPackageName(),
    });
  }

  sleep(1000);
  exit();
}

ensureFloatyPermission();

// 1. 适配 K50 至尊版 1.5K 屏幕 (2712 x 1220)
setScreenMetrics(2712, 1220);

// 2. 状态悬浮窗
var window = floaty.rawWindow(
  <frame rect="120 20 455 255" bg="#ee0f172a" cardCornerRadius="16dp">
    <vertical padding="10 8 10 10">
      <text
        text="采购连点器 Pro"
        color="#ffffff"
        textSize="15sp"
        textStyle="bold"
        gravity="center"
      />
      <text
        id="status"
        text="待机中，请先添加点位"
        color="#93c5fd"
        textSize="10sp"
        gravity="center"
        marginTop="3"
      />
      <horizontal gravity="center" marginTop="3">
        <text
          id="setInfo"
          text="组 1/1"
          color="#dbeafe"
          textSize="10sp"
          gravity="center"
        />
        <text
          text="  |  "
          color="#475569"
          textSize="10sp"
          gravity="center"
        />
        <text
          id="pointInfo"
          text="0 个点位"
          color="#94a3b8"
          textSize="10sp"
          gravity="center"
        />
      </horizontal>
      <button
        id="toggleBtn"
        text="开始抢购"
        textColor="#ffffff"
        textSize="13sp"
        textStyle="bold"
        bg="#2563eb"
        marginTop="8"
        h="34"
      />
      <horizontal marginTop="6">
        <button
          id="prevSetBtn"
          text="上组"
          textColor="#ffffff"
          textSize="10sp"
          bg="#334155"
          w="0"
          layout_weight="1"
          h="30"
        />
        <button
          id="newSetBtn"
          text="新建组"
          textColor="#ffffff"
          textSize="10sp"
          bg="#7c3aed"
          w="0"
          layout_weight="1"
          h="30"
          marginLeft="6"
        />
        <button
          id="nextSetBtn"
          text="下组"
          textColor="#ffffff"
          textSize="10sp"
          bg="#334155"
          w="0"
          layout_weight="1"
          h="30"
          marginLeft="6"
        />
      </horizontal>
      <horizontal marginTop="6">
        <button
          id="addPointBtn"
          text="添加点位"
          textColor="#ffffff"
          textSize="11sp"
          bg="#059669"
          w="0"
          layout_weight="1"
          h="32"
        />
        <button
          id="clearPointBtn"
          text="清空点位"
          textColor="#ffffff"
          textSize="11sp"
          bg="#475569"
          w="0"
          layout_weight="1"
          h="32"
          marginLeft="6"
        />
      </horizontal>
    </vertical>
  </frame>,
);

var isRunning = false;
var isPickingPoint = false;
var thread = null;
var isCleaningUp = false;
var lifecycleCallbacks = null;
var pointPickerWindow = null;
var storage = storages.create("caigou_autoclick_config");
var pointSets = loadPointSets();
var currentSetIndex = storage.get("currentSetIndex", 0);
var clickPoints = [];
var pickerTargetX = 0;
var pickerTargetY = 0;
var pickerDragOffsetX = 0;
var pickerDragOffsetY = 0;

syncCurrentClickPoints();

try {
  window.setTouchable(true);
} catch (e) {}

bindAppCloseCleanup();
bindFloatingPanelActions();
refreshPointInfo();

// 3. 悬浮窗按钮控制开始/暂停
function bindFloatingPanelActions() {
  try {
    window.toggleBtn.click(function () {
      toggleHuntingMode();
    });
    window.addPointBtn.click(function () {
      startPointPicker();
    });
    window.clearPointBtn.click(function () {
      clearClickPoints();
    });
    window.prevSetBtn.click(function () {
      switchPointSet(-1);
    });
    window.nextSetBtn.click(function () {
      switchPointSet(1);
    });
    window.newSetBtn.click(function () {
      createPointSet();
    });
  } catch (e) {}
}

function toggleHuntingMode() {
  if (!isRunning) {
    startScript();
  } else {
    stopScript();
  }
}

function startScript() {
  if (isPickingPoint) {
    toast("请先完成点位选择");
    return;
  }

  if (clickPoints.length === 0) {
    updateFloatingPanel("请先添加至少 1 个点位", "#fbbf24", "开始抢购", "#2f7dff");
    toast("请先添加点位");
    return;
  }

  isRunning = true;

  updateFloatingPanel("抢购模式运行中", "#34d399", "暂停抢购", "#ef4444");
  thread = threads.start(runHuntingMode);
}

function updateFloatingPanel(statusText, statusColor, buttonText, buttonColor) {
  ui.run(() => {
    if (!window) {
      return;
    }

    window.status.setText(statusText);
    window.status.setTextColor(colors.parseColor(statusColor));
    window.toggleBtn.setText(buttonText);
    window.toggleBtn.setBackgroundColor(colors.parseColor(buttonColor));
  });
}

function loadPointSets() {
  let savedSets = storage.get("pointSets", null);

  if (savedSets && savedSets.length > 0) {
    return savedSets;
  }

  let oldPoints = storage.get("clickPoints", []);
  return [
    {
      name: "点位组1",
      points: oldPoints || [],
    },
  ];
}

function syncCurrentClickPoints() {
  if (!pointSets || pointSets.length === 0) {
    pointSets = [
      {
        name: "点位组1",
        points: [],
      },
    ];
  }

  if (currentSetIndex < 0) {
    currentSetIndex = 0;
  }

  if (currentSetIndex >= pointSets.length) {
    currentSetIndex = pointSets.length - 1;
  }

  if (!pointSets[currentSetIndex].points) {
    pointSets[currentSetIndex].points = [];
  }

  clickPoints = pointSets[currentSetIndex].points;
}

function refreshPointInfo() {
  syncCurrentClickPoints();

  ui.run(() => {
    if (!window) {
      return;
    }

    window.setInfo.setText("组 " + (currentSetIndex + 1) + "/" + pointSets.length);
    window.pointInfo.setText(clickPoints.length + " 个点位");
  });
}

function saveClickPoints() {
  pointSets[currentSetIndex].points = clickPoints;
  saveAllPointSets();
  refreshPointInfo();
}

function saveAllPointSets() {
  storage.put("pointSets", pointSets);
  storage.put("currentSetIndex", currentSetIndex);
  storage.put("clickPoints", clickPoints);
}

function switchPointSet(direction) {
  if (isRunning || isPickingPoint) {
    toast("请先暂停或完成选点");
    return;
  }

  if (pointSets.length <= 1) {
    toast("当前只有 1 个点位组");
    return;
  }

  pointSets[currentSetIndex].points = clickPoints;
  currentSetIndex = (currentSetIndex + direction + pointSets.length) % pointSets.length;
  syncCurrentClickPoints();
  saveAllPointSets();
  refreshPointInfo();
  updateFloatingPanel("已切换到点位组 " + (currentSetIndex + 1), "#38bdf8", "开始抢购", "#2f7dff");
}

function createPointSet() {
  if (isRunning || isPickingPoint) {
    toast("请先暂停或完成选点");
    return;
  }

  pointSets[currentSetIndex].points = clickPoints;
  pointSets.push({
    name: "点位组" + (pointSets.length + 1),
    points: [],
  });
  currentSetIndex = pointSets.length - 1;
  syncCurrentClickPoints();
  saveAllPointSets();
  refreshPointInfo();
  updateFloatingPanel("已新建点位组 " + (currentSetIndex + 1), "#34d399", "开始抢购", "#2f7dff");
}

function clearClickPoints() {
  if (isRunning) {
    toast("请先暂停再清空点位");
    return;
  }

  clickPoints = [];
  saveClickPoints();
  updateFloatingPanel("当前点位组已清空", "#fbbf24", "开始抢购", "#2f7dff");
}

function startPointPicker() {
  if (isRunning) {
    toast("请先暂停再添加点位");
    return;
  }

  if (isPickingPoint) {
    toast("正在等待选择点位");
    return;
  }

  isPickingPoint = true;
  updateFloatingPanel("拖动准星到目标位置后点确定", "#38bdf8", "等待选点", "#64748b");

  threads.start(function () {
    sleep(300);
    showPointPicker();
  });
}

function showPointPicker() {
  ui.run(() => {
    pointPickerWindow = floaty.rawWindow(
      <frame id="picker" bg="#55000000">
        <text
          id="target"
          text="◎"
          color="#22d3ee"
          textSize="64sp"
          textStyle="bold"
          gravity="center"
          bg="#66111827"
          w="96"
          h="96"
        />
        <vertical gravity="bottom|center" padding="24 0 24 44">
          <text
            id="pickerTips"
            text="拖动准星到目标位置，然后点确定"
            color="#ffffff"
            textSize="15sp"
            textStyle="bold"
            gravity="center"
            bg="#dd111827"
            padding="18 10 18 8"
          />
          <text
            id="pickerPosition"
            text="当前坐标：0, 0"
            color="#bfdbfe"
            textSize="12sp"
            gravity="center"
            bg="#dd111827"
            padding="18 0 18 10"
          />
          <horizontal>
            <button
              id="confirmPointBtn"
              text="确定添加"
              textColor="#ffffff"
              textSize="14sp"
              bg="#10b981"
              w="0"
              layout_weight="1"
              h="44"
            />
            <button
              id="cancelPointBtn"
              text="取消"
              textColor="#ffffff"
              textSize="14sp"
              bg="#64748b"
              w="0"
              layout_weight="1"
              h="44"
              marginLeft="10"
            />
          </horizontal>
        </vertical>
      </frame>,
    );

    pointPickerWindow.setSize(-1, -1);
    pointPickerWindow.setTouchable(true);

    pickerTargetX = Math.max(0, Math.round(device.width / 2 - 48));
    pickerTargetY = Math.max(0, Math.round(device.height / 2 - 48));
    movePickerTarget(pickerTargetX, pickerTargetY);

    pointPickerWindow.target.setOnTouchListener(function (view, event) {
      if (event.getAction() === MotionEvent.ACTION_DOWN) {
        pickerDragOffsetX = view.getX() - event.getRawX();
        pickerDragOffsetY = view.getY() - event.getRawY();
        return true;
      }

      if (event.getAction() === MotionEvent.ACTION_MOVE) {
        movePickerTarget(
          Math.round(event.getRawX() + pickerDragOffsetX),
          Math.round(event.getRawY() + pickerDragOffsetY),
        );
        return true;
      }

      return true;
    });

    pointPickerWindow.confirmPointBtn.click(function () {
      addClickPoint(getPickerCenterX(), getPickerCenterY());
      closePointPicker();
    });

    pointPickerWindow.cancelPointBtn.click(function () {
      closePointPicker();
      updateFloatingPanel("已取消添加点位", "#fbbf24", "开始抢购", "#2f7dff");
    });
  });
}

function movePickerTarget(x, y) {
  if (!pointPickerWindow) {
    return;
  }

  pickerTargetX = Math.max(0, x);
  pickerTargetY = Math.max(0, y);

  try {
    pointPickerWindow.target.setX(pickerTargetX);
    pointPickerWindow.target.setY(pickerTargetY);
    pointPickerWindow.pickerPosition.setText(
      "当前坐标：" + getPickerCenterX() + ", " + getPickerCenterY(),
    );
  } catch (e) {}
}

function getPickerCenterX() {
  try {
    return Math.round(pickerTargetX + (pointPickerWindow.target.getWidth() || 96) / 2);
  } catch (e) {
    return Math.round(pickerTargetX + 48);
  }
}

function getPickerCenterY() {
  try {
    return Math.round(pickerTargetY + (pointPickerWindow.target.getHeight() || 96) / 2);
  } catch (e) {
    return Math.round(pickerTargetY + 48);
  }
}

function addClickPoint(x, y) {
  clickPoints.push({
    x: x,
    y: y,
    duration: 25,
    times: 1,
  });

  saveClickPoints();
  updateFloatingPanel("已添加第 " + clickPoints.length + " 个点位", "#34d399", "开始抢购", "#2f7dff");
  toast("已添加点位：" + x + ", " + y);
}

function closePointPicker() {
  isPickingPoint = false;

  try {
    if (pointPickerWindow) {
      pointPickerWindow.close();
      pointPickerWindow = null;
    }
  } catch (e) {}
}

function bindAppCloseCleanup() {
  events.on("exit", function () {
    cleanupAndCloseWindow();
  });

  try {
    if (ui && ui.emitter) {
      ui.emitter.on("destroy", function () {
        cleanupAndCloseWindow();
      });
    }
  } catch (e) {}

  try {
    if (typeof activity === "undefined" || !activity) {
      return;
    }

    importClass(android.app.Application);

    lifecycleCallbacks = new JavaAdapter(Application.ActivityLifecycleCallbacks, {
      onActivityCreated: function () {},
      onActivityStarted: function () {},
      onActivityResumed: function () {},
      onActivityPaused: function () {},
      onActivityStopped: function () {},
      onActivitySaveInstanceState: function () {},
      onActivityDestroyed: function (closedActivity) {
        if (closedActivity == activity) {
          cleanupAndCloseWindow();
        }
      },
    });

    activity.getApplication().registerActivityLifecycleCallbacks(lifecycleCallbacks);
  } catch (e) {}
}

// 4. 核心抢购逻辑
function runHuntingMode() {
  function reinforcedPress(x, y, duration, times) {
    let rx = x + random(-3, 3);
    let ry = y + random(-3, 3);

    for (let i = 0; i < times; i++) {
      press(rx, ry, duration);
    }
  }

  while (isRunning) {
    for (let i = 0; i < clickPoints.length && isRunning; i++) {
      let point = clickPoints[i];
      reinforcedPress(point.x, point.y, point.duration || 25, point.times || 1);

      // 点位之间留一点点间隔，避免触控指令堆积。
      sleep(random(5, 12));
    }

    // 给系统 5ms 的喘息时间，防止指令堆积导致触控队列卡死
    sleep(5);
  }
}

function stopScript() {
  isRunning = false;
  if (thread) {
    thread.interrupt();
    thread = null;
  }

  updateFloatingPanel("已暂停，点击按钮可继续", "#fbbf24", "开始抢购", "#2f7dff");
  toast("抢购已暂停");
}

function cleanupAndCloseWindow() {
  if (isCleaningUp) {
    return;
  }

  isCleaningUp = true;
  isRunning = false;

  try {
    if (thread) thread.interrupt();
  } catch (e) {}

  closePointPicker();

  try {
    if (window) {
      window.close();
      window = null;
    }
  } catch (e) {}
}

// 5. 自动销毁逻辑
setInterval(() => {
  try {
    if (!context || !window) {
      cleanupAndCloseWindow();
      exit();
    }
  } catch (e) {
    cleanupAndCloseWindow();
    exit();
  }
}, 500);
