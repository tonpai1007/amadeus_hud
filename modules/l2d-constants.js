// modules/l2d-constants.js - AMADEUS Live2D Constants & Parameter Mappings
window.AMADEUS = window.AMADEUS || {};

(function() {
  const EMOTION_AURA = {
    neutral:       { r: 204, g:  50, b:  53, glow: 0.06 },
    calm:          { r: 255, g: 110, b: 120, glow: 0.05 },
    content:       { r: 255, g: 170, b: 180, glow: 0.07 },
    amused:        { r: 255, g: 175, b: 200, glow: 0.11 },
    smug:          { r: 255, g: 200, b: 120, glow: 0.09, flash: true },
    proud:         { r: 255, g: 130, b: 110, glow: 0.13, flash: true },
    jealous:       { r: 255, g:  60, b: 160, glow: 0.18, flash: true },
    happy:         { r: 255, g: 120, b: 170, glow: 0.11 },
    excited:       { r: 255, g:  95, b: 150, glow: 0.16, flash: true },
    surprised:     { r: 255, g: 180, b: 200, glow: 0.14, flash: true },
    curious:       { r: 235, g: 120, b: 140, glow: 0.08 },
    focused:       { r: 230, g:  90, b: 110, glow: 0.07 },
    confused:      { r: 240, g: 150, b: 170, glow: 0.09 },
    thinking:      { r: 230, g:  80, b: 100, glow: 0.07 },
    angry:         { r: 255, g:  65, b:  70, glow: 0.20, flash: true },
    annoyed:       { r: 255, g: 130, b:  75, glow: 0.10 },
    frustrated:    { r: 255, g: 100, b:  65, glow: 0.14 },
    sad:           { r: 160, g:  70, b: 110, glow: 0.03 },
    bitter:        { r: 140, g:  60, b:  90, glow: 0.03 },
    tired:         { r: 170, g: 100, b: 120, glow: 0.04 },
    sleepy:        { r: 150, g:  85, b: 110, glow: 0.03 },
    sleeping:      { r: 120, g:  60, b:  90, glow: 0.025 },
  };

  const PARAM_MAP_CUBISM4 = {
    angleX: 'ParamAngleX',
    angleY: 'ParamAngleY',
    angleZ: 'ParamAngleZ',
    eyeLOpen: 'ParamEyeLOpen',
    eyeROpen: 'ParamEyeROpen',
    eyeLSmile: 'ParamEyeLSmile',
    eyeRSmile: 'ParamEyeRSmile',
    eyeBallX: 'ParamEyeBallX',
    eyeBallY: 'ParamEyeBallY',
    browLY: 'ParamBrowLY',
    browRY: 'ParamBrowRY',
    browLX: 'ParamBrowLX',
    browRX: 'ParamBrowRX',
    browLAngle: 'ParamBrowLAngle',
    browRAngle: 'ParamBrowRAngle',
    browLForm: 'ParamBrowLForm',
    browRForm: 'ParamBrowRForm',
    mouthOpenY: 'ParamMouthOpenY',
    mouthForm: 'ParamMouthForm',
    bodyAngleX: 'ParamBodyAngleX',
    bodyAngleY: 'ParamBodyAngleY',
    bodyAngleZ: 'ParamBodyAngleZ',
    breath: 'ParamBreath',
    armChange: 'ParamArmChange',
    cheek: 'ParamCheek',
  };

  const PARAM_MAP_CUBISM2 = {
    angleX: 'PARAM_ANGLE_X',
    angleY: 'PARAM_ANGLE_Y',
    angleZ: 'PARAM_ANGLE_Z',
    eyeLOpen: 'PARAM_EYE_L_OPEN',
    eyeROpen: 'PARAM_EYE_R_OPEN',
    eyeLSmile: 'PARAM_EYE_L_SMILE',
    eyeRSmile: 'PARAM_EYE_R_SMILE',
    eyeBallX: 'PARAM_EYE_BALL_X',
    eyeBallY: 'PARAM_EYE_BALL_Y',
    browLY: 'PARAM_BROW_L_Y',
    browRY: 'PARAM_BROW_R_Y',
    browLX: 'PARAM_BROW_L_X',
    browRX: 'PARAM_BROW_R_X',
    browLAngle: 'PARAM_BROW_L_ANGLE',
    browRAngle: 'PARAM_BROW_R_ANGLE',
    browLForm: 'PARAM_BROW_L_FORM',
    browRForm: 'PARAM_BROW_R_FORM',
    mouthOpenY: 'PARAM_MOUTH_OPEN_Y',
    mouthForm: 'PARAM_MOUTH_FORM',
    bodyAngleX: 'PARAM_BODY_ANGLE_X',
    bodyAngleY: 'PARAM_BODY_ANGLE_Y',
    bodyAngleZ: 'PARAM_BODY_ANGLE_Z',
    breath: 'PARAM_BREATH',
    armChange: 'PARAM_ARM_CHANGE',
    cheek: 'PARAM_CHEEK',
  };

  /**
    * AMADEUS Live2D constants: emotion→aura color table and Cubism 2/4
    * parameter-name maps shared by the controller subsystems.
    */
  window.AMADEUS.L2D_CONSTANTS = {
    EMOTION_AURA,
    PARAM_MAP_CUBISM4,
    PARAM_MAP_CUBISM2,
    MAX_DPR: 1.5,
  };
})();
