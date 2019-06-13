/**
 * @file index
 * @author Jim Bulkowski <jim.b@paperelectron.com>
 * @project taskrunner
 * @license MIT {@link http://opensource.org/licenses/MIT}
 */

import {CreatePlugin} from "@pomegranate/plugin-tools";
import {ActionTrees} from "./Plugins/ActionTrees";
import {ActionRunner} from "./Plugins/ActionRunner";

export const Plugin = CreatePlugin('application')
  .configuration({name: 'TaskRunner'})
  .applicationPlugins([
    ActionTrees,
    ActionRunner
  ])