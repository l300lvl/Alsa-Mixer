/*
 * This file is part of Alsa Controller.
 *
 * Alsa Controller is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Alsa Mixer is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const St = imports.gi.St;
const Lang = imports.lang;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Util = imports.misc.util;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Widget = Me.imports.widget;
const Convenience = Me.imports.convenience;

const VOLUME_STEP = 4;
const MIXER_ELEMENT = 'Master';

const AlsaMixer = new Lang.Class({
  Name: 'AlsaMixer',
  Extends: PanelMenu.SystemStatusButton,

  _init: function() {
    this.parent('audio-volume-medium', _('Volume'));

    this.statusIcon = new St.Icon({
      icon_name: 'audio-volume-medium',
      style_class: 'status-icon'
    });
    this.actor.add_actor(this.statusIcon);

    this._onScrollId = this.actor.connect('scroll-event',
        Lang.bind(this, this._onScroll));

    var vols = this._getVolume();
    this._cVolume = vols[0];
    this._pVolume = vols[1];
    this._muted = this._getMute();
    this._autoMuted = this._getAutoMute();
    this._updateIcon(this._cVolume, this._muted);

    this.pup = new Widget.SliderItem("   ".concat(String(this._pVolume)), this._cVolume / 64);
    this._onSliderId = this.pup.connect('value-changed', Lang.bind(this, this._onSlider));
    this.menu.addMenuItem(this.pup);

    this.showMute = Convenience.getSettings('org.gnome.shell.extensions.alsaVolbar').get_boolean('showmute');
    if (this.showMute) {
      this.muteMenuItem = new Widget.SwitchItem("Sound", !this._muted, { reactive: true });
      this.muteMenuItem.connect('toggled', Lang.bind(this, this._handleMuteMenuItem));
      this.menu.addMenuItem(this.muteMenuItem);
    }

    this.showAutoMute = Convenience.getSettings('org.gnome.shell.extensions.alsaVolbar').get_boolean('showautomute');
    if (this.showAutoMute) {
      this.autoMuteMenuItem = new Widget.SwitchItem("Auto Mute", this._autoMuted, { reactive: true });
      this.autoMuteMenuItem.connect('toggled', Lang.bind(this, this._handleAutoMuteMenuItem));
      this.menu.addMenuItem(this.autoMuteMenuItem);
    }

    this.showAlsamixer = Convenience.getSettings('org.gnome.shell.extensions.alsaVolbar').get_boolean('showalsamixer');

    if (this.showAlsamixer) {
      this.alsamixer = new PopupMenu.PopupMenuItem("Alsamixer", {
        reactive: true
      });
      this.alsamixer.connect('activate', Lang.bind(this, this._openAlsamixer));
      this.menu.addMenuItem(this.alsamixer);
    }

    this._timeoutId = Mainloop.timeout_add_seconds(1,
        Lang.bind(this, this._onUpdate));
  },

  _openAlsamixer: function(actor, event) {
    GLib.spawn_command_line_async('gnome-terminal -x sh -c "alsamixer"');
  },

  _handleMuteMenuItem: function(actor, event) {
    if (event == false) {
      GLib.spawn_command_line_async(
          'amixer -q set %s mute '.format(MIXER_ELEMENT));
      this._muted = true;
      this._updateIcon(0, true);
    }
    else if (event == true) {
      GLib.spawn_command_line_async(
          'amixer -q set %s unmute '.format(MIXER_ELEMENT));
      this._muted = false;
      this._updateIcon(this._cVolume, false);
    }
  },

  _handleAutoMuteMenuItem: function(actor, event) {
    if (event == false) {
      GLib.spawn_command_line_async( 'amixer -q set Auto-Mute\\ Mode Disabled');
      this._autoMuted = true;
    }
    else if (event == true) {
      GLib.spawn_command_line_async( 'amixer -q set Auto-Mute\\ Mode Enabled');
      this._autoMuted = false;
    }
  },

  _getVolume: function() {
    let cmd = GLib.spawn_command_line_sync(
        'env LANG=C amixer get %s'.format(MIXER_ELEMENT));
    let re = /(\d{1,2})\s\[(\d{1,3})\%\]/m;
    let values = re.exec(cmd[1]);
    if (values === null || values[1] === null) {
      global.log("Error - regex failed in _getVolume");
      return 0;
    }
    return [Number(values[1]), Number(values[2])];
  },

  _getMute: function() {
    let cmd = GLib.spawn_command_line_sync(
        'env LANG=C amixer get %s'.format(MIXER_ELEMENT));
    let re = /\[(on|off)\]/m;
    let values = re.exec(cmd[1]);
    if (values === null || values[1] === null) {
      global.log("Error - regex failed in _getMute");
      return false;
    }
    return (values[1] === "off");
  },

  _getAutoMute: function() {
    let cmd = GLib.spawn_command_line_sync('env LANG=C amixer get Auto-Mute\\ Mode');
    global.log(cmd[1]);
    let re = /Item0: '(Disabled|Enabled)'/m;
    let values = re.exec(cmd[1]);
    if (values === null || values[1] === null) {
      global.log("Error - regex failed in _getAutoMute");
      return false;
    }
    return (values[1] === "Enabled");
  },

  _setVolume: function(value) {
    let cmd = GLib.spawn_command_line_async(
        'amixer -q set %s %s %%'.format(MIXER_ELEMENT, value));

    this._cVolume = value;
    this._pVolume = value * (100 / 64);
    if (this._pVolume % 1 == 0.5) {
      this._pVolume = Math.floor(this._pVolume); //Amixer rounds down when halfway
    }
    else {
      this._pVolume = Math.round(this._pVolume);
    }
    this.pup.setLabel(this._pVolume);
    var muted = this._getMute();
    if (value != 0 && muted) {
      GLib.spawn_command_line_async(
          'amixer -q set %s unmute '.format(MIXER_ELEMENT));
      if (this.showMute) {
        this.muteMenuItem.setToggleState(true);
      }
      muted = false;
    }

    this._updateIcon(value, false);
  },

  _updateIcon: function(value, muted) {
    var iconValue = this._getIcon(value, muted);
    if (this.statusIcon.get_icon_name() != iconValue) {
      let icon = iconValue;
      this.statusIcon.set_icon_name(icon);
      this.setIcon(icon);
    }
  },

  _getIcon: function(volume, muted) {
    let rvalue = 'audio-volume-muted';
    if (volume < 1 || muted) {
      rvalue = 'audio-volume-muted';
    }
    else {
      let num = Math.floor(volume * 0.046875); //0.046875 = 3/64

      if (num >= 2)
        rvalue = 'audio-volume-high';
      else if (num < 1)
        rvalue = 'audio-volume-low';
      else
        rvalue = 'audio-volume-medium';
    }
    return rvalue;
  },

  _onScroll: function(widget, event) {

    let di = event.get_scroll_direction();

    if (di == Clutter.ScrollDirection.DOWN) {
      if (Number(this._cVolume) > VOLUME_STEP) {
        this._setVolume(Number(this._cVolume) - VOLUME_STEP);
      }
      else {
        this._setVolume(0);
      }
    }
    else if (di == Clutter.ScrollDirection.UP) {
      if (Number(this._cVolume) < 64 - VOLUME_STEP) {
        this._setVolume(Number(this._cVolume) + VOLUME_STEP);
      }
      else {
        this._setVolume(64);
      }
    }
    if (this._getMute() && this._cVolume != 0) {
      if (this.showMute) {
        this.muteMenuItem.setToggleState(false);
      }
    }
    this.pup.setValue(this._cVolume / 64);
  },

  _onSlider: function(slider, value) {
    let volume = Math.round(value * 64);
    this.pup.setValue(volume / 64);
    this._setVolume(volume);
  },

  _onUpdate: function() {
    var vols = this._getVolume();
    var oldVol = this._pVolume;
    var oldMute = this._muted;
    this._cVolume = vols[0];
    this._pVolume = vols[1];
    this._muted = this._getMute();
    if (oldVol != this._pVolume) {
      this._updateIcon(this._cVolume, this._muted);
      this.pup.setValue(Number(this._cVolume) / 64);
      this.pup.setLabel(this._pVolume);
      if (this.showMute) {
        this.muteMenuItem.setToggleState(!this._muted);
      }
    }
    else if (oldMute != this._muted) {
      this._updateIcon(this._cVolume, this._muted);
      if (this.showMute) {
        this.muteMenuItem.setToggleState(!this._muted);
      }
    }
    if (this.showAutoMute) {
      this._autoMuted = this._getAutoMute();
      this.autoMuteMenuItem.setToggleState(this._autoMuted);
    }
    return true;
  },

  destroy: function() {
    this.parent();
    Mainloop.source_remove(this._timeoutId);
    this.actor.disconnect(this._onScrollId);
    this.pup.disconnect(this._onSliderId);
  },
});

function init() {
  // pass
}

var AM;

function enable() {
  AM = new AlsaMixer();
  Main.panel.addToStatusArea('AlsaMixer', AM);
}

function disable() {
  AM.destroy();
  AM = null;
}
